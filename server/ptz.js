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
async function sendPtzCommand(cmd, devices) {
    // Resolve Target Camera(s)
    let targets = [];
    if (cmd.target === 'ALL' || !cmd.target) {
        targets = Object.values(devices);
    } else {
        const dev = devices[cmd.target];
        if (dev) targets.push(dev);
    }

    // Process each target
    const promises = targets.map(device => {
        const protocol = device.protocol || 'panasonic';
        const handler = protocols[protocol];

        if (!handler) return Promise.resolve();

        const devId = Object.keys(devices).find(key => devices[key] === device) || device.ip;

        // --- WATCHDOG LOGIC ---
        // 1. Clear existing timer for this device
        if (deviceWatchdogs[devId]) {
            clearTimeout(deviceWatchdogs[devId]);
            delete deviceWatchdogs[devId];
        }

        // 2. If this is a MOVE command, set a new "Dead Man's Switch" timer
        // If we don't hear from this device again in 600ms, Force Stop.
        if (cmd.action.startsWith('PAN') || cmd.action.startsWith('TILT') || cmd.action.startsWith('ZOOM')) {
            deviceWatchdogs[devId] = setTimeout(() => {
                console.log(`[Watchdog] Timeout for ${device.name || device.ip} -> Force STOP`);
                handler.stop(device).catch(err => console.error(`[Watchdog] Stop failed: ${err}`));
                delete deviceWatchdogs[devId];
            }, 600);
        }
        // 3. If STOP, we just cleared the timer above, so we are good.

        return handler.sendCommand(device, cmd.action, cmd.speed || 50);
    });

    await Promise.all(promises);
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
