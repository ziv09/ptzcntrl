/**
 * Panasonic AW Series PTZ Protocol
 * Uses HTTP CGI commands
 */

const axios = require('axios');

/**
 * Send PTZ command to Panasonic camera
 * @param {Object} device - Device info {ip, port, name}
 * @param {string} action - PTZ action (PAN_LEFT, TILT_UP, ZOOM_IN, etc.)
 * @param {number} speed - Speed value (0-100)
 */
async function sendCommand(device, action, speed = 50) {
    const cgiParams = mapCommandToCgi(action, speed);
    const url = `http://${device.ip}/cgi-bin/aw_ptz?cmd=%23${cgiParams}&res=1`;

    console.log(`[Panasonic] Sending to ${device.ip}: ${cgiParams}`);

    try {
        await axios.get(url, { timeout: 500 });
        return { success: true };
    } catch (error) {
        console.error(`[Panasonic] Error sending to ${device.ip}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Stop all movement on Panasonic camera
 * @param {Object} device - Device info
 */
async function stop(device) {
    const url = `http://${device.ip}/cgi-bin/aw_ptz?cmd=%23P50T50Z50&res=1`;
    try {
        await axios.get(url, { timeout: 500 });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Map generic action to Panasonic CGI command
 */
const MAX_DELTA = 49;
const BASE_VAL = 50;

/**
 * Map generic action to Panasonic CGI command with variable speed
 */
function mapCommandToCgi(action, speed) {
    // Ensure speed is 0-100
    const safeSpeed = Math.max(0, Math.min(100, speed));
    const speedDelta = Math.round((safeSpeed / 100) * MAX_DELTA);

    // Default to Center (Stop)
    let panVal = BASE_VAL;
    let tiltVal = BASE_VAL;
    let zoomVal = BASE_VAL;

    switch (action) {
        case 'PAN_LEFT':
            panVal = BASE_VAL - speedDelta;
            break;
        case 'PAN_RIGHT':
            panVal = BASE_VAL + speedDelta;
            break;
        case 'TILT_UP':
            tiltVal = BASE_VAL + speedDelta;
            break;
        case 'TILT_DOWN':
            tiltVal = BASE_VAL - speedDelta;
            break;
        case 'ZOOM_IN':
            zoomVal = BASE_VAL + speedDelta; // 50-99
            return `Z${pad(zoomVal)}`;
        case 'ZOOM_OUT':
            zoomVal = BASE_VAL - speedDelta; // 50-01
            return `Z${pad(zoomVal)}`;
        case 'STOP':
            return 'P50T50Z50'; // Universal STOP (Pan, Tilt, Zoom all stop)
        case 'PRESET_CALL':
            return `R${pad(speed)}`;
        case 'PRESET_SET':
            return `M${pad(speed)}`;
    }

    // Clamp values 01-99
    panVal = clamp(panVal, 1, 99);
    tiltVal = clamp(tiltVal, 1, 99);

    // Return PTS string e.g. PTS4550 for slow left
    return `PTS${pad(panVal)}${pad(tiltVal)}`;
}

function pad(num) {
    return Math.round(num).toString().padStart(2, '0');
}

function clamp(num, min, max) {
    return Math.min(Math.max(num, min), max);
}

/**
 * Discover Panasonic cameras on network
 * Uses AW protocol multicast
 */
async function discover() {
    const dgram = require('dgram');
    const devices = [];

    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        const PANASONIC_PORT = 52380;
        const DISCOVERY_MSG = Buffer.from([0x00, 0x00, 0x00, 0x00]);

        socket.on('message', (msg, rinfo) => {
            devices.push({
                ip: rinfo.address,
                port: 80,
                protocol: 'panasonic',
                name: `Panasonic (${rinfo.address})`,
                mac: rinfo.address.replace(/\./g, '')
            });
        });

        socket.bind(() => {
            socket.setBroadcast(true);
            socket.send(DISCOVERY_MSG, 0, DISCOVERY_MSG.length, PANASONIC_PORT, '255.255.255.255');

            setTimeout(() => {
                socket.close();
                resolve(devices);
            }, 3000);
        });
    });
}

module.exports = {
    sendCommand,
    stop,
    discover,
    protocol: 'panasonic'
};
