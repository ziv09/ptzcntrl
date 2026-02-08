/**
 * NDI PTZ Protocol
 * NewTek NDI devices with PTZ support
 * Uses HTTP REST API (NDI|HX compatible)
 */

const axios = require('axios');

// NDI PTZ typically uses HTTP REST on port 5961 or device-specific port
const DEFAULT_NDI_PORT = 80;

/**
 * Send PTZ command to NDI device via HTTP
 * Note: NDI PTZ API varies by manufacturer
 * This implements the common HTTP-based approach
 */
async function sendCommand(device, action, params = 50) {
    let speed = 50;
    if (typeof params === 'object') {
        speed = params.speed || 50;
    } else {
        speed = params;
    }
    const port = device.port || DEFAULT_NDI_PORT;
    const baseUrl = `http://${device.ip}:${port}`;

    // Normalize speed to 0.0 - 1.0 range
    const normalizedSpeed = speed / 100;

    let endpoint = '/ptz';
    let queryParams = {};

    try {
        switch (action) {
            case 'PAN_LEFT':
                queryParams = { pan_speed: -normalizedSpeed };
                break;
            case 'PAN_RIGHT':
                queryParams = { pan_speed: normalizedSpeed };
                break;
            case 'TILT_UP':
                queryParams = { tilt_speed: normalizedSpeed };
                break;
            case 'TILT_DOWN':
                queryParams = { tilt_speed: -normalizedSpeed };
                break;
            case 'ZOOM_IN':
                queryParams = { zoom_speed: normalizedSpeed };
                break;
            case 'ZOOM_OUT':
                queryParams = { zoom_speed: -normalizedSpeed };
                break;
            case 'STOP':
                queryParams = { pan_speed: 0, tilt_speed: 0, zoom_speed: 0 };
                break;
            case 'PRESET_CALL':
                endpoint = `/ptz/preset/${speed}`;
                break;
            case 'PRESET_SET':
                endpoint = `/ptz/preset/${speed}/store`;
                break;
            default:
                return { success: false, error: 'Unknown action' };
        }

        console.log(`[NDI] Sending ${action} to ${device.ip}:${port}`);

        // Try common NDI PTZ API endpoints
        try {
            // Method 1: Query params
            await axios.get(`${baseUrl}${endpoint}`, {
                params: queryParams,
                timeout: 2000
            });
        } catch {
            // Method 2: PTZOptics style
            try {
                await axios.get(`${baseUrl}/cgi-bin/ptzctrl.cgi`, {
                    params: { ptzcmd: mapToNdiCmd(action, speed) },
                    timeout: 2000
                });
            } catch {
                // Method 3: Direct POST
                await axios.post(`${baseUrl}/ptz`, queryParams, { timeout: 2000 });
            }
        }

        return { success: true };

    } catch (error) {
        console.error(`[NDI] Error:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Map action to NDI/PTZOptics style command
 */
function mapToNdiCmd(action, speed) {
    switch (action) {
        case 'PAN_LEFT': return 'left';
        case 'PAN_RIGHT': return 'right';
        case 'TILT_UP': return 'up';
        case 'TILT_DOWN': return 'down';
        case 'ZOOM_IN': return 'zoomin';
        case 'ZOOM_OUT': return 'zoomout';
        case 'STOP': return 'ptzstop';
        case 'PRESET_CALL': return `poscall&posnum=${speed}`;
        case 'PRESET_SET': return `posset&posnum=${speed}`;
        default: return 'ptzstop';
    }
}

/**
 * Stop all movement
 */
async function stop(device) {
    return await sendCommand(device, 'STOP');
}

/**
 * Discover NDI devices
 * Note: Full NDI discovery requires native SDK
 * This is a placeholder for HTTP-based devices
 */
async function discover() {
    console.log('[NDI] Note: Full NDI discovery requires native SDK');
    console.log('[NDI] HTTP-based NDI devices must be manually configured');
    return [];
}

module.exports = {
    sendCommand,
    stop,
    discover,
    protocol: 'ndi'
};
