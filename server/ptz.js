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

// Global Watchdog Timer
let watchdogTimer = null;

/**
 * Send PTZ command to device(s)
 * @param {Object} cmd - Command object { action, target, speed }
 * @param {Object} devices - Device registry
 */
async function sendPtzCommand(cmd, devices) {
    // 1. Reset Watchdog for MOVE commands
    if (cmd.action.startsWith('PAN') || cmd.action.startsWith('TILT') || cmd.action.startsWith('ZOOM')) {
        resetWatchdog(devices);
    }

    // 2. Resolve Target Camera(s)
    const targets = [];
    if (cmd.target === 'ALL' || !cmd.target) {
        Object.values(devices).forEach(d => targets.push(d));
    } else {
        const dev = devices[cmd.target];
        if (dev) targets.push(dev);
    }

    // 3. Send commands to each target
    const promises = targets.map(device => {
        const protocol = device.protocol || 'panasonic'; // Default to panasonic
        const handler = protocols[protocol];

        if (!handler) {
            console.error(`[PTZ] Unknown protocol: ${protocol}`);
            return Promise.resolve({ success: false, error: 'Unknown protocol' });
        }

        return handler.sendCommand(device, cmd.action, cmd.speed || 50);
    });

    await Promise.all(promises);
}

/**
 * Reset watchdog timer - stops cameras if no commands received
 */
function resetWatchdog(devices) {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
        console.log("Watchdog Triggered: Stopping All Cameras");
        stopAllCameras(devices);
    }, 600);
}

/**
 * Stop all cameras using appropriate protocol
 */
async function stopAllCameras(devices) {
    const targets = Object.values(devices);

    const promises = targets.map(device => {
        const protocol = device.protocol || 'panasonic';
        const handler = protocols[protocol];

        if (handler) {
            return handler.stop(device);
        }
        return Promise.resolve();
    });

    await Promise.all(promises);
}

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
    getSupportedProtocols,
    stopAllCameras
};
