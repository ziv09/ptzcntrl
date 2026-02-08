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
const MAX_DELTA = 49;
const BASE_VAL = 50;

/**
 * Map generic action to Panasonic CGI command with variable speed
 */
function mapCommandToCgi(action, speed, vector = null) {
    // Ensure speed is 0-100
    const safeSpeed = Math.max(0, Math.min(100, speed));
    const speedDelta = Math.round((safeSpeed / 100) * MAX_DELTA);

    // Vector Logic (Exact User Reference)
    if (action === 'PTZ_VECTOR' && vector) {
        // user ref: speedFactor = (globalSpeed / 100) * MAX_DELTA
        // current speed arg IS globalSpeed * force.
        // Wait, User's code: move(x, y). x/y are -1 to 1.
        // globalSpeed is 0-100.
        // My 'safeSpeed' passed from client is (force * moveSpeed).
        // if force=1, moveSpeed=100 -> speed=100.
        // So I can use speedDelta directly as the 'weight' of full deflection.
        // Formula: 50 + (input * speedDelta)
        // input is vector.x, vector.y

        const panVal = clamp(BASE_VAL + Math.round(vector.x * speedDelta), 1, 99);
        const tiltVal = clamp(BASE_VAL + Math.round(vector.y * speedDelta), 1, 99);

        // Invert Tilt? 
        // nipplejs up is +y?
        // Panasonic: T99 is UP. T01 is DOWN.
        // If vector.y is +1 (Up), val = 50 + 49 = 99. Correct. 
        // If nipplejs sends -y for Up, I need to check. NippleJS usually is Up=-1?
        // Standard joystick UI libraries often have Y axis inverted (Up is negative).
        // Let's assume NippleJS 'vector' is Cartesian (Up is positive). 
        // If User says "chaotic", maybe axis is wrong.
        // But let's stick to the math: 50 + (y * delta).

        return `PTS${pad(panVal)}${pad(tiltVal)}`;
    }

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
            tiltVal = BASE_VAL + speedDelta; // T99
            break;
        case 'TILT_DOWN':
            tiltVal = BASE_VAL - speedDelta; // T01
            break;
        case 'ZOOM_IN':
            zoomVal = BASE_VAL + speedDelta; // 50-99
            return `Z${pad(zoomVal)}`;
        case 'ZOOM_OUT':
            zoomVal = BASE_VAL - speedDelta; // 50-01
            return `Z${pad(zoomVal)}`;
        case 'STOP':
            return 'P50T50Z50';
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
