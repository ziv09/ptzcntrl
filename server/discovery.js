/**
 * Multi-Protocol Device Discovery
 * Discovers devices across Panasonic, ONVIF, VISCA, and NDI protocols
 */

const { discoverAll } = require('./ptz');

let discoveredDevices = {};

/**
 * Run discovery across all protocols
 * @returns {Object} Dictionary of discovered devices keyed by ID
 */
async function autoDiscovery() {
    console.log('[Discovery] Starting Multi-Protocol Auto Discovery...');

    try {
        const devices = await discoverAll();

        devices.forEach((device) => {
            // Use MAC or generate ID from IP
            const id = device.mac || device.ip.replace(/\./g, '');

            discoveredDevices[id] = {
                id: id,
                ip: device.ip,
                port: device.port || 80,
                name: device.name || `Camera (${device.ip})`,
                protocol: device.protocol || 'panasonic',
                type: getTypeLabel(device.protocol),
                lastSeen: Date.now(),
                // ONVIF specific
                profileToken: device.profileToken,
                xaddr: device.xaddr,
                // Credentials (optional)
                username: device.username,
                password: device.password
            };

            console.log(`[Discovery] Found: ${discoveredDevices[id].name} (${device.protocol}) at ${device.ip}`);
        });

        console.log(`[Discovery] Total devices: ${Object.keys(discoveredDevices).length}`);
        return discoveredDevices;

    } catch (e) {
        console.error('[Discovery] Error:', e);
        return discoveredDevices;
    }
}

/**
 * Add device manually
 * @param {Object} deviceInfo - Device configuration
 */
function addDevice(deviceInfo) {
    const id = deviceInfo.id || deviceInfo.ip.replace(/\./g, '');

    discoveredDevices[id] = {
        id: id,
        ip: deviceInfo.ip,
        port: deviceInfo.port || getDefaultPort(deviceInfo.protocol),
        name: deviceInfo.name || `Camera (${deviceInfo.ip})`,
        protocol: deviceInfo.protocol || 'panasonic',
        type: getTypeLabel(deviceInfo.protocol),
        lastSeen: Date.now(),
        username: deviceInfo.username,
        password: deviceInfo.password
    };

    console.log(`[Discovery] Manually added: ${deviceInfo.ip} (${deviceInfo.protocol})`);
    return discoveredDevices[id];
}

/**
 * Remove device
 */
function removeDevice(id) {
    if (discoveredDevices[id]) {
        delete discoveredDevices[id];
        console.log(`[Discovery] Removed device: ${id}`);
        return true;
    }
    return false;
}

/**
 * Get default port for protocol
 */
function getDefaultPort(protocol) {
    switch (protocol) {
        case 'panasonic': return 80;
        case 'onvif': return 80;
        case 'visca': return 52381;
        case 'ndi': return 80;
        default: return 80;
    }
}

/**
 * Get human-readable type label
 */
function getTypeLabel(protocol) {
    switch (protocol) {
        case 'panasonic': return 'Panasonic AW';
        case 'onvif': return 'ONVIF';
        case 'visca': return 'VISCA/Sony';
        case 'ndi': return 'NDI';
        default: return 'Unknown';
    }
}

/**
 * Get all devices
 */
function getDevices() {
    return discoveredDevices;
}

module.exports = {
    autoDiscovery,
    addDevice,
    removeDevice,
    getDevices,
    discoveredDevices
};
