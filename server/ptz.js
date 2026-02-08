/**
 * PTZ Command Router
 * Routes commands to appropriate protocol handler
 */

// Protocol Modules
const panasonic = require('./protocols/panasonic');
const onvif = require('./protocols/onvif');
const visca = require('./protocols/visca');
const ndi = require('./protocols/ndi');

// Protocol map
const protocols = {
    panasonic,
    onvif,
    visca,
    ndi
};

// Per-Device Watchdog Timers
const deviceWatchdogs = {};

/**
 * Send PTZ command to device(s)
 * @param {Object} cmd - Command object { action, target, speed }
 * @param {Object} devices - Device registry
 */
// Per-Device Command Queue (Mutex + Conflation)
// deviceIp -> boolean (is executing?)
const deviceBusy = {};
// deviceIp -> { cmd, device, resolve, reject } (next command to run)
const devicePending = {};

/**
 * Send PTZ command to device(s)
 * @param {Object} cmd - Command object { action, target, speed }
 * @param {Object} devices - Device registry
 */
async function sendPtzCommand(cmd, devices) {
    // Resolve Target Camera(s)
    let targets = [];
    if (cmd.target === 'ALL' || !cmd.target) {
        targets = Object.values(devices);
    } else {
        const dev = devices[cmd.target];
        if (dev) targets.push(dev);
    }

    // Process each target via Queue
    const promises = targets.map(device => {
        const protocol = device.protocol || 'panasonic';
        const handler = protocols[protocol];

        if (!handler) return Promise.resolve();

        // Use IP as key
        const devId = device.ip;

        // --- WATCHDOG LOGIC (Keep existing safety) ---
        if (deviceWatchdogs[devId]) {
            clearTimeout(deviceWatchdogs[devId]);
            delete deviceWatchdogs[devId];
        }
        if (cmd.action !== 'STOP' && (cmd.action.startsWith('PAN') || cmd.action.startsWith('TILT') || cmd.action.startsWith('ZOOM'))) {
            deviceWatchdogs[devId] = setTimeout(() => {
                console.log(`[Watchdog] Timeout for ${device.name || device.ip} -> Force STOP`);
                // Force stop bypasses queue? No, should use queue ideally, but force is force.
                // Let's call queue with STOP.
                queueCommand(devId, device, handler, { action: 'STOP' });
                delete deviceWatchdogs[devId];
            }, 600);
        }

        // --- QUEUE LOGIC ---
        return queueCommand(devId, device, handler, cmd);
    });

    await Promise.all(promises);
}

/**
 * Queue command execution for a device (Mutex + Conflation)
 */
function queueCommand(devId, device, handler, cmd) {
    return new Promise((resolve, reject) => {
        // If device is busy, update PENDING command (overwrite previous pending)
        if (deviceBusy[devId]) {
            // PRIORITY BYPASS: If command is STOP, do NOT wait.
            // Fire immediately in parallel to kill movement ASAP.
            if (cmd.action === 'STOP') {
                console.log(`[PTZ] Priority STOP for ${devId} (Bypassing Queue)`);
                // Attempt to execute immediately (ignoring busy flag lock)
                // This might cause 2 requests at once, but better than runaway.
                // We also clear any pending move commands to prevent re-starting.
                if (devicePending[devId]) {
                    delete devicePending[devId];
                }
                // Don't set busy=true here to avoid messing up the existing lock's cleanup.
                // Just fire handler.
                handler.sendCommand(device, cmd.action, cmd.speed || 50)
                    .then(res => resolve(res))
                    .catch(err => resolve({ success: false, error: err.message }));
                return;
            }

            // Conflation: We only care about the latest command.
            // If there was a pending command, we drop it (it's now obsolete).
            if (devicePending[devId]) {
                // Optional: reject previous pending? Or just silently drop?
                // Silently drop is better for PTZ smoothness.
                // console.log(`[PTZ] Dropped stale command for ${devId}`);
            }
            devicePending[devId] = { cmd, device, handler, resolve, reject };
            return;
        }

        // If not busy, execute immediately
        executeCommand(devId, device, handler, cmd, resolve, reject);
    });
}

/**
 * Execute command and process next in queue
 */
async function executeCommand(devId, device, handler, cmd, resolve, reject) {
    deviceBusy[devId] = true;

    // console.log(`[PTZ] Sending ${cmd.action} to ${devId}`);

    try {
        const result = await handler.sendCommand(device, cmd.action, cmd.speed || 50);
        resolve(result);
    } catch (error) {
        console.error(`[PTZ] Error sending to ${devId}:`, error);
        resolve({ success: false, error: error.message }); // Don't reject promise chain
    } finally {
        // Command finished. Check pending.
        const next = devicePending[devId];
        delete devicePending[devId];

        if (next) {
            // Run next pending command immediately
            executeCommand(devId, next.device, next.handler, next.cmd, next.resolve, next.reject);
        } else {
            // Nothing pending, release lock
            deviceBusy[devId] = false;
        }
    }
}

// (Removed global resetWatchdog and stopAllCameras as they are replaced by per-device logic)

/**
 * Discover all devices across all protocols
 * @returns {Promise<Array>} Array of discovered devices
 */
async function discoverAll() {
    console.log('[PTZ] Starting multi-protocol discovery...');

    const results = await Promise.allSettled([
        panasonic.discover(),
        onvif.discover(),
        visca.discover(),
        ndi.discover()
    ]);

    const allDevices = [];

    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            allDevices.push(...result.value);
        } else {
            console.error(`[PTZ] Discovery error for protocol ${index}:`, result.reason);
        }
    });

    console.log(`[PTZ] Total discovered: ${allDevices.length} devices`);
    return allDevices;
}

/**
 * Get supported protocols
 */
function getSupportedProtocols() {
    return Object.keys(protocols);
}

module.exports = {
    sendPtzCommand,
    discoverAll,
    getSupportedProtocols
};
