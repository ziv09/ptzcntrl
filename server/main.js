const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage } = require('electron');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const os = require('os');
const ip = require('ip');
const fs = require('fs');
const { autoDiscovery } = require('./discovery');
const { sendPtzCommand } = require('./ptz');
const { verifyCommand, sanitizeCommand } = require('./security');

// --- Icon Handling ---
const iconPath = path.join(__dirname, '../build/icon.png'); // Use PNG
let appIcon = nativeImage.createEmpty();
if (fs.existsSync(iconPath)) {
    try {
        appIcon = nativeImage.createFromPath(iconPath);
    } catch (e) { console.error("Icon load error:", e); }
} else {
    console.warn("Icon not found at:", iconPath);
}

// --- Global State ---
let mainWindow = null;
let tray = null;
let roomId = null;
let roomPassword = null;
let firebaseConnected = false;
let devices = {};
let onlineUsers = 0;
let serverPort = 5000;

// --- Firebase Setup ---
try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://ptzcntrl-default-rtdb.asia-southeast1.firebasedatabase.app/"
    });
    console.log("Firebase Admin Initialized");
} catch (error) {
    console.error("Firebase Init Error:", error);
}

const db = admin.database();

// --- Express Server (Local GUI) ---
const serverApp = express();
serverApp.use(bodyParser.json());
serverApp.use(express.static(path.join(__dirname, 'public')));

// New: Manual IP Addition
serverApp.post('/api/manual-ip', (req, res) => {
    const { ip } = req.body;
    if (ip) {
        // Add to active devices map
        devices[`manual_${Date.now()}`] = {
            ip: ip,
            type: 'manual',
            status: 'unknown'
        };
        res.json({ success: true, devices });
        updateDashboard();
    } else {
        res.status(400).json({ error: "Missing IP" });
    }
});

serverApp.post('/api/config', (req, res) => {
    const { room, pass } = req.body;
    if (room && pass) {
        if (roomId) stopFirebaseListener(); // Stop previous if exists
        roomId = room;
        roomPassword = pass;
        startFirebaseListener(roomId);
        res.json({ success: true });
        updateDashboard();
    } else {
        res.status(400).json({ error: "Missing fields" });
    }
});

serverApp.post('/api/stop', (req, res) => {
    stopFirebaseListener();
    roomId = null;
    roomPassword = null;
    res.json({ success: true });
    updateDashboard();
});

serverApp.get('/api/status', (req, res) => {
    res.json({
        roomId,
        connected: firebaseConnected,
        devices: devices,
        users: onlineUsersList,
        ip: ip.address()
    });
});

const server = serverApp.listen(serverPort, () => {
    console.log(`Local GUI running on http://localhost:${serverPort}`);
});

// --- Electron Main Window ---
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 600,
        icon: appIcon,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true,
        resizable: false,
        show: false
    });

    mainWindow.loadFile(path.join(__dirname, 'dashboard.html'));

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });
}

// --- System Tray ---
function createTray() {
    tray = new Tray(appIcon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Open Dashboard', click: () => mainWindow.show() },
        { label: 'Open Local GUI', click: () => shell.openExternal(`http://localhost:${serverPort}`) },
        { type: 'separator' },
        {
            label: 'Exit', click: () => {
                app.isQuitting = true;
                if (roomId) stopFirebaseListener();
                app.quit();
            }
        }
    ]);
    tray.setToolTip('PTZ Controller');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => mainWindow.show());
}

// --- Logic ---
let onlineUsersList = [];
let activeRoomRef = null; // Track current ref for cleanup
let serverLogs = [];

function logBuffer(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${msg}`;
    console.log(logEntry); // Still log to terminal

    serverLogs.unshift({ time: timestamp, msg: msg, type: type });
    if (serverLogs.length > 50) serverLogs.pop();
}

async function stopFirebaseListener() {
    if (roomId && activeRoomRef) {
        logBuffer(`Stopping Server for Room: ${roomId}`, 'warn');

        try {
            // Remove room data to notify clients
            // Await ensures this completes before we proceed (e.g. to quit)
            await activeRoomRef.remove();

            // Detach listeners
            activeRoomRef.off();
            activeRoomRef.child('request_login').off();
            activeRoomRef.child('sessions').off();
            activeRoomRef.child('commands').off();
            db.ref('.info/connected').off();

            logBuffer(`Room ${roomId} data removed and listeners detached.`, 'success');
        } catch (e) {
            console.error("Error removing room data:", e);
        }

        activeRoomRef = null;
        firebaseConnected = false;
        onlineUsersList = [];

        // Security: Clear credentials from memory
        roomId = null;
        roomPassword = null;

        updateDashboard();
    }
}

function startFirebaseListener(room) {
    if (!room) return;

    // Stop existing if any (safety)
    // Note: If calling from a sync context, we might not await this, 
    // but typically we start from API which is async-ish or handled.
    if (activeRoomRef) {
        // Best effort to stop previous, though usually we stop before start in UI
        // We won't await here to keep signature simple unless we make this async too
        // but for now, rely on API flow.
        activeRoomRef.off();
        activeRoomRef = null;
    }

    activeRoomRef = db.ref(`rooms/${room}`);

    // 1. Register Presence
    const deviceRef = activeRoomRef.child('devices').push();
    const presenceRef = db.ref('.info/connected');
    presenceRef.on('value', (snap) => {
        if (snap.val() === true) {
            deviceRef.onDisconnect().remove();
            deviceRef.set({
                type: 'controller',
                ip: ip.address(),
                status: 'online',
                timestamp: admin.database.ServerValue.TIMESTAMP
            });
            firebaseConnected = true;
            logBuffer("Firebase Connected", 'success');
            updateDashboard();
        } else {
            firebaseConnected = false;
            updateDashboard();
        }
    });

    // 2. Listen for Login Requests
    const loginRef = activeRoomRef.child('request_login');
    loginRef.on('child_added', (snapshot) => {
        const req = snapshot.val();
        if (!req) return;

        const requestId = snapshot.key;
        const isValid = (req.password === roomPassword);

        // Write Session Result
        if (isValid) {
            logBuffer(`Login Approved: ${req.username || 'Unknown'}`, 'success');
            activeRoomRef.child(`sessions/${requestId}`).set({
                authorized: true,
                username: req.username || 'Anonymous', // Store Name
                timestamp: admin.database.ServerValue.TIMESTAMP
            });
        } else {
            logBuffer(`Login Denied: ${requestId}`, 'warn');
            activeRoomRef.child(`sessions/${requestId}`).set({
                authorized: false,
                timestamp: admin.database.ServerValue.TIMESTAMP
            });
        }

        // Remove request
        snapshot.ref.remove();
    });

    // 2.5 Listen for Active Sessions (Sync Users)
    activeRoomRef.child('sessions').on('value', (snap) => {
        const val = snap.val();
        onlineUsersList = [];
        if (val) {
            Object.keys(val).forEach(key => {
                if (val[key].authorized) {
                    onlineUsersList.push({
                        id: key,
                        username: val[key].username || 'Anonymous',
                        timestamp: val[key].timestamp
                    });
                }
            });
        }
        onlineUsers = onlineUsersList.length;
        updateDashboard();
    });

    // 3. Listen for Commands
    activeRoomRef.child('commands').on('child_added', async (snapshot) => {
        const cmdData = snapshot.val();
        if (!cmdData) return;

        // Verify Password (Local Check)
        if (cmdData.password === roomPassword) {
            const user = cmdData.username || 'Unknown';
            const action = cmdData.action;
            const target = cmdData.target || 'ALL';
            logBuffer(`CMD: ${action} > ${target} (${user})`);

            // Send to PTZ
            await sendPtzCommand(cmdData, devices);
        } else {
            logBuffer(`CMD Failed: Auth Error for ${cmdData.action}`, 'error');
        }

        // Remove command after processing (Queue style)
        snapshot.ref.remove();
    });

    // 3. Update Devices (from Auto Discovery)
    setInterval(() => {
        // Periodically update device list in Firebase if changed
        // For now, just keep alive
    }, 10000);
}

function updateDashboard() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status-update', {
            ip: ip.address(),
            roomId,
            connected: firebaseConnected,
            deviceCount: Object.keys(devices).length,
            onlineUsers // To be implemented
        });
    }
}

// --- App Lifecycle ---
app.whenReady().then(() => {
    createWindow();
    createTray();
    mainWindow.show();
});

app.on('window-all-closed', () => {
    // Do nothing, keep tray alive
});

// IPC
ipcMain.on('open-gui', () => {
    shell.openExternal(`http://localhost:${serverPort}`);
});
ipcMain.on('hide-window', () => {
    mainWindow.hide();
});
ipcMain.on('quit-app', async () => {
    app.isQuitting = true;
    if (roomId) await stopFirebaseListener();
    app.quit();
});
