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
/**
 * Send PTZ command to Panasonic camera
 * @param {Object} device - Device info {ip, port, name}
 * @param {string} action - PTZ action
 * @param {number|Object} params - Speed (int) or Object {speed, vector}
 */
let lastCmds = {}; // Store last command per IP for deduplication

async function sendCommand(device, action, params = 50) {
    let speed = 50;
    let vector = null;

    if (typeof params === 'object') {
        speed = params.speed || 50;
        vector = params.vector || null; // {x, y}
    } else {
        speed = params;
    }

    // Debug Log
    if (action === 'PTZ_VECTOR') {
        if (vector) console.log(`[Panasonic] VECTOR: x=${vector.x.toFixed(2)}, y=${vector.y.toFixed(2)}, s=${speed}`);
        else console.log(`[Panasonic] VECTOR: Missing Data!`);
    }

    const cgiParams = mapCommandToCgi(action, speed, vector);

    // Deduplication: If same as last command for this IP, skip
    // We append device.ip to key to separate cameras
    const key = device.ip;
    if (lastCmds[key] === cgiParams) {
        // console.log(`[Panasonic] Skipping duplicate cmd for ${key}`);
        return { success: true, skipped: true };
    }
    lastCmds[key] = cgiParams;

    const url = `http://${device.ip}/cgi-bin/aw_ptz?cmd=%23${cgiParams}&res=1`;

    console.log(`[Panasonic] >>> Action: ${action}, Speed: ${speed}, CGI: ${cgiParams}`);

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
 */
async function stop(device) {
    // Reset lastCmd so next move is allowed
    delete lastCmds[device.ip];

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
/**
 * Map generic action to Panasonic CGI command
 */
const MAX_DELTA = 49;
const BASE_VAL = 50;

/**
 * Map generic action to Panasonic CGI command with variable speed
 */
function mapCommandToCgi(action, speed, vector = null) {
    // Ensure speed is 0-100
    const safeSpeed = Math.max(0, Math.min(100, speed));
    const speedFactor = (safeSpeed / 100) * MAX_DELTA; // User Spec: (globalSpeed / 100) * MAX_DELTA

    // Vector Logic (User Reference Implementation)
    if (action === 'PTZ_VECTOR' && vector) {
        // Deadzone Check - Reduced from 0.1 to 0.02 for mobile touch sensitivity
        const deadzone = 0.02;
        if (Math.abs(vector.x) < deadzone && Math.abs(vector.y) < deadzone) {
            return 'PTS5050'; // Stop
        }

        // Logic: 50 + round(input * speedFactor)
        // input: -1.0 ~ 1.0 (Left/Down ~ Right/Up)
        const panVal = clamp(BASE_VAL + Math.round(vector.x * speedFactor), 1, 99);
        const tiltVal = clamp(BASE_VAL + Math.round(vector.y * speedFactor), 1, 99);

        return `PTS${pad(panVal)}${pad(tiltVal)}`;
    }

    // Default to Center (Stop)
    let panVal = BASE_VAL;
    let tiltVal = BASE_VAL;
    let zoomVal = BASE_VAL;
    // For discrete actions if vector is null - use same speedFactor? 
    // User spec calcValue delta = round(input * speedFactor).
    // For Discrete Button: input is +/- 1.0.
    const delta = Math.round(1.0 * speedFactor);

    switch (action) {
        case 'PAN_LEFT':
            panVal = BASE_VAL - delta;
            break;
        case 'PAN_RIGHT':
            panVal = BASE_VAL + delta;
            break;
        case 'TILT_UP':
            tiltVal = BASE_VAL + delta; // T99
            break;
        case 'TILT_DOWN':
            tiltVal = BASE_VAL - delta; // T01
            break;
        case 'ZOOM_IN':
            zoomVal = BASE_VAL + Math.round(speedFactor); // 50-99
            return `Z${pad(zoomVal)}`;
        case 'ZOOM_OUT':
            zoomVal = BASE_VAL - Math.round(speedFactor); // 50-01
            return `Z${pad(zoomVal)}`;
        case 'ZOOM_STOP':
            return 'Z50';
        case 'STOP':
            // Use PTS format to match move commands
            return 'PTS5050';
        case 'PRESET_CALL':
            return `R${pad(speed)}`;
        case 'PRESET_SET':
            return `M${pad(speed)}`;
    }

    // Clamp values 01-99
    panVal = clamp(panVal, 1, 99);
    tiltVal = clamp(tiltVal, 1, 99);

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
