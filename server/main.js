const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage } = require('electron');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const os = require('os');
const ip = require('ip');
const fs = require('fs');
const { autoDiscovery, addDevice, getDevices } = require('./discovery');
const { sendPtzCommand, getSupportedProtocols } = require('./ptz');
const { verifyCommand, sanitizeCommand } = require('./security');

// --- Icon Handling ---
const iconPath = path.join(__dirname, '../build/icon.png'); // Use icon.png
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

// Manual Device Addition with Protocol Selection
serverApp.post('/api/manual-ip', (req, res) => {
    const { ip, protocol, port, name, username, password } = req.body;
    if (ip) {
        const device = addDevice({
            ip: ip,
            protocol: protocol || 'panasonic',
            port: port,
            name: name || `Camera (${ip})`,
            username: username,
            password: password
        });
        devices = getDevices();
        res.json({ success: true, device, devices });
        updateDashboard();
    } else {
        res.status(400).json({ error: "Missing IP" });
    }
});

// Get supported protocols
serverApp.get('/api/protocols', (req, res) => {
    res.json({ protocols: getSupportedProtocols() });
});

// Auto-probe IP to detect protocol
serverApp.post('/api/probe-ip', async (req, res) => {
    const { ip } = req.body;
    if (!ip) {
        return res.status(400).json({ error: "Missing IP" });
    }

    console.log(`[Probe] Auto-detecting protocol for ${ip}...`);

    // Try each protocol in order of likelihood
    const protocols = ['onvif', 'panasonic', 'visca', 'ndi'];
    const axios = require('axios');
    const onvif = require('node-onvif');

    for (const protocol of protocols) {
        try {
            let detected = false;
            let name = '';

            switch (protocol) {
                case 'onvif':
                    // Try ONVIF connection
                    const device = new onvif.OnvifDevice({
                        xaddr: `http://${ip}/onvif/device_service`
                    });
                    await device.init();
                    detected = true;
                    name = device.getInformation()?.Manufacturer || 'ONVIF Camera';
                    break;

                case 'panasonic':
                    // Try Panasonic CGI
                    const panaRes = await axios.get(`http://${ip}/cgi-bin/aw_ptz?cmd=%23O&res=1`, { timeout: 2000 });
                    if (panaRes.data) {
                        detected = true;
                        name = 'Panasonic PTZ';
                    }
                    break;

                case 'visca':
                    // VISCA detection is harder, assume if port 52381 responds
                    const dgram = require('dgram');
                    detected = await new Promise((resolve) => {
                        const socket = dgram.createSocket('udp4');
                        const buf = Buffer.from([0x81, 0x09, 0x00, 0x02, 0xFF]); // Inquiry
                        socket.send(buf, 52381, ip);
                        socket.on('message', () => { socket.close(); resolve(true); });
                        setTimeout(() => { socket.close(); resolve(false); }, 1000);
                    });
                    if (detected) name = 'VISCA Camera';
                    break;

                case 'ndi':
                    // Try NDI HTTP endpoint
                    const ndiRes = await axios.get(`http://${ip}/`, { timeout: 2000 });
                    if (ndiRes.data && ndiRes.data.toString().toLowerCase().includes('ndi')) {
                        detected = true;
                        name = 'NDI Camera';
                    }
                    break;
            }

            if (detected) {
                console.log(`[Probe] Detected ${protocol} at ${ip}`);
                const device = addDevice({
                    ip: ip,
                    protocol: protocol,
                    name: name || `Camera (${ip})`
                });
                devices = getDevices();
                updateDashboard();
                return res.json({ success: true, device, protocol });
            }
        } catch (e) {
            // Protocol not detected, try next
            console.log(`[Probe] ${protocol} not detected at ${ip}: ${e.message}`);
        }
    }

    // If no protocol detected, default to ONVIF (most common)
    console.log(`[Probe] No protocol detected for ${ip}, defaulting to ONVIF`);
    const device = addDevice({
        ip: ip,
        protocol: 'onvif',
        name: `Camera (${ip})`
    });
    devices = getDevices();
    updateDashboard();
    res.json({ success: true, device, protocol: 'onvif', note: 'Auto-assigned (undetected)' });
});

// Background discovery (every 30 seconds)
setInterval(async () => {
    console.log('[Background] Running auto-discovery...');
    try {
        await autoDiscovery();
        devices = getDevices();
        updateDashboard();
    } catch (e) {
        console.error('[Background] Discovery error:', e.message);
    }
}, 30000);

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
    // 1. Update Electron GUI
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status-update', {
            ip: ip.address(),
            roomId,
            connected: firebaseConnected,
            deviceCount: Object.keys(devices).length,
            onlineUsers // To be implemented
        });
    }

    // 2. Sync Devices to Firebase (Crucial for Web App)
    if (firebaseConnected && activeRoomRef) {
        // Transform devices object for Firebase (remove non-serializable if any)
        const devicesUpdate = {};
        Object.keys(devices).forEach(key => {
            devicesUpdate[key] = {
                name: devices[key].name,
                ip: devices[key].ip,
                protocol: devices[key].protocol || 'panasonic',
                port: devices[key].port,
                status: 'online' // Assume online if in list
            };
        });

        // Update specific devices node 
        // We use 'update' to avoid wiping other potential data, though 'set' might be cleaner for full sync
        activeRoomRef.child('devices').update(devicesUpdate);
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
