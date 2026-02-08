/**
 * ONVIF PTZ Protocol
 * Universal IP camera standard
 */

const onvif = require('node-onvif');

// Cache for ONVIF device connections
const deviceCache = new Map();

/**
 * Get or create ONVIF device connection
 */
async function getDevice(deviceInfo) {
    const key = `${deviceInfo.ip}:${deviceInfo.port || 80}`;

    if (deviceCache.has(key)) {
        return deviceCache.get(key);
    }

    const device = new onvif.OnvifDevice({
        xaddr: `http://${deviceInfo.ip}:${deviceInfo.port || 80}/onvif/device_service`,
        user: deviceInfo.username || 'admin',
        pass: deviceInfo.password || 'admin',
        timeout: 2000 // Connection timeout
    });

    try {
        await device.init();
        deviceCache.set(key, device);
        return device;
    } catch (error) {
        console.error(`[ONVIF] Failed to connect to ${deviceInfo.ip}:`, error.message);
        throw error;
    }
}

/**
 * Send PTZ command via ONVIF
 * @param {Object} deviceInfo - Device info {ip, port, username, password, profileToken}
 * @param {string} action - PTZ action
 * @param {number} speed - Speed value (0-100)
 */
async function sendCommand(deviceInfo, action, speed = 50) {
    try {
        const device = await getDevice(deviceInfo);
        const profileToken = deviceInfo.profileToken || device.getCurrentProfile().token;

        // Normalize speed to -1.0 to 1.0 range
        const normalizedSpeed = (speed - 50) / 50;

        let params = {
            ProfileToken: profileToken,
            Velocity: { x: 0, y: 0, z: 0 }
        };

        switch (action) {
            case 'PAN_LEFT':
                params.Velocity.x = -Math.abs(normalizedSpeed) || -0.5;
                break;
            case 'PAN_RIGHT':
                params.Velocity.x = Math.abs(normalizedSpeed) || 0.5;
                break;
            case 'TILT_UP':
                params.Velocity.y = Math.abs(normalizedSpeed) || 0.5;
                break;
            case 'TILT_DOWN':
                params.Velocity.y = -Math.abs(normalizedSpeed) || -0.5;
                break;
            case 'ZOOM_IN':
                params.Velocity.z = Math.abs(normalizedSpeed) || 0.5;
                break;
            case 'ZOOM_OUT':
                params.Velocity.z = -Math.abs(normalizedSpeed) || -0.5;
                break;
            case 'STOP':
                await device.ptzStop({ ProfileToken: profileToken });
                return { success: true };
            case 'PRESET_CALL':
                await device.ptzGotoPreset({
                    ProfileToken: profileToken,
                    PresetToken: String(speed)
                });
                return { success: true };
            case 'PRESET_SET':
                await device.ptzSetPreset({
                    ProfileToken: profileToken,
                    PresetToken: String(speed)
                });
                return { success: true };
            default:
                return { success: false, error: 'Unknown action' };
        }

        await device.ptzContinuousMove(params);
        console.log(`[ONVIF] Sent ${action} to ${deviceInfo.ip}`);
        return { success: true };

    } catch (error) {
        console.error(`[ONVIF] Error:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Stop all movement
 */
async function stop(deviceInfo) {
    try {
        const device = await getDevice(deviceInfo);
        const profileToken = deviceInfo.profileToken || device.getCurrentProfile().token;
        await device.ptzStop({ ProfileToken: profileToken });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Discover ONVIF devices on network
 */
async function discover() {
    console.log('[ONVIF] Starting device discovery...');

    try {
        const deviceInfos = await onvif.startProbe();

        const devices = deviceInfos.map(info => ({
            ip: new URL(info.xaddrs[0]).hostname,
            port: parseInt(new URL(info.xaddrs[0]).port) || 80,
            protocol: 'onvif',
            name: info.name || `ONVIF (${new URL(info.xaddrs[0]).hostname})`,
            mac: info.urn ? info.urn.split(':').pop() : new URL(info.xaddrs[0]).hostname.replace(/\./g, ''),
            xaddr: info.xaddrs[0]
        }));

        console.log(`[ONVIF] Found ${devices.length} devices`);
        return devices;

    } catch (error) {
        console.error('[ONVIF] Discovery error:', error.message);
        return [];
    }
}

module.exports = {
    sendCommand,
    stop,
    discover,
    protocol: 'onvif'
};
