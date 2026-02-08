/**
 * VISCA over IP Protocol
 * Sony and compatible PTZ cameras
 * Uses UDP port 52381
 */

const dgram = require('dgram');

// VISCA Constants
const VISCA_PORT = 52381;
const VISCA_HEADER = 0x81; // Camera address 1

// VISCA Command Bytes
const VISCA_COMMANDS = {
    // Pan/Tilt
    PAN_TILT: [0x01, 0x06, 0x01], // + speed + direction
    PAN_TILT_STOP: [0x01, 0x06, 0x01, 0x03, 0x03, 0x03, 0x03],

    // Zoom
    ZOOM_IN: [0x01, 0x04, 0x07, 0x02],  // Tele
    ZOOM_OUT: [0x01, 0x04, 0x07, 0x03], // Wide
    ZOOM_STOP: [0x01, 0x04, 0x07, 0x00],

    // Presets
    PRESET_RECALL: [0x01, 0x04, 0x3F, 0x02], // + preset number
    PRESET_SET: [0x01, 0x04, 0x3F, 0x01]     // + preset number
};

/**
 * Send raw VISCA command via UDP
 */
function sendViscaUdp(ip, port, command) {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');
        const buffer = Buffer.from([VISCA_HEADER, ...command, 0xFF]);

        socket.send(buffer, 0, buffer.length, port, ip, (err) => {
            socket.close();
            if (err) {
                reject(err);
            } else {
                resolve({ success: true });
            }
        });

        // Timeout
        setTimeout(() => {
            socket.close();
            resolve({ success: true }); // VISCA doesn't always ACK
        }, 100);
    });
}

/**
 * Send PTZ command via VISCA
 * @param {Object} device - Device info {ip, port}
 * @param {string} action - PTZ action
 * @param {number} speed - Speed value (0-100)
 */
async function sendCommand(device, action, speed = 50) {
    const port = device.port || VISCA_PORT;

    // Map speed to VISCA range (0x01 - 0x18 for pan/tilt)
    const viscaSpeed = Math.max(1, Math.min(24, Math.floor(speed / 4.2)));

    let command;

    try {
        switch (action) {
            case 'PAN_LEFT':
                command = [...VISCA_COMMANDS.PAN_TILT, viscaSpeed, viscaSpeed, 0x01, 0x03];
                break;
            case 'PAN_RIGHT':
                command = [...VISCA_COMMANDS.PAN_TILT, viscaSpeed, viscaSpeed, 0x02, 0x03];
                break;
            case 'TILT_UP':
                command = [...VISCA_COMMANDS.PAN_TILT, viscaSpeed, viscaSpeed, 0x03, 0x01];
                break;
            case 'TILT_DOWN':
                command = [...VISCA_COMMANDS.PAN_TILT, viscaSpeed, viscaSpeed, 0x03, 0x02];
                break;
            case 'ZOOM_IN':
                command = VISCA_COMMANDS.ZOOM_IN;
                break;
            case 'ZOOM_OUT':
                command = VISCA_COMMANDS.ZOOM_OUT;
                break;
            case 'STOP':
                // Send both pan/tilt stop and zoom stop
                await sendViscaUdp(device.ip, port, VISCA_COMMANDS.PAN_TILT_STOP);
                command = VISCA_COMMANDS.ZOOM_STOP;
                break;
            case 'PRESET_CALL':
                command = [...VISCA_COMMANDS.PRESET_RECALL, speed];
                break;
            case 'PRESET_SET':
                command = [...VISCA_COMMANDS.PRESET_SET, speed];
                break;
            default:
                return { success: false, error: 'Unknown action' };
        }

        console.log(`[VISCA] Sending ${action} to ${device.ip}:${port}`);
        return await sendViscaUdp(device.ip, port, command);

    } catch (error) {
        console.error(`[VISCA] Error:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Stop all movement
 */
async function stop(device) {
    const port = device.port || VISCA_PORT;

    try {
        await sendViscaUdp(device.ip, port, VISCA_COMMANDS.PAN_TILT_STOP);
        await sendViscaUdp(device.ip, port, VISCA_COMMANDS.ZOOM_STOP);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Discover VISCA devices (limited - VISCA doesn't have standard discovery)
 * Returns empty array - devices must be manually added
 */
async function discover() {
    console.log('[VISCA] Note: VISCA devices must be manually configured');
    return [];
}

module.exports = {
    sendCommand,
    stop,
    discover,
    protocol: 'visca'
};
