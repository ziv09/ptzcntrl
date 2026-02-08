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
        await axios.get(url, { timeout: 2000 });
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
        await axios.get(url, { timeout: 1000 });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Map generic action to Panasonic CGI command
 */
function mapCommandToCgi(action, speed) {
    switch (action) {
        case 'PAN_LEFT': return 'P01';
        case 'PAN_RIGHT': return 'P99';
        case 'TILT_UP': return 'T99';
        case 'TILT_DOWN': return 'T01';
        case 'ZOOM_IN': return 'Z99';
        case 'ZOOM_OUT': return 'Z01';
        case 'STOP': return 'P50T50Z50';
        case 'PRESET_CALL': return `R${String(speed).padStart(2, '0')}`;
        case 'PRESET_SET': return `M${String(speed).padStart(2, '0')}`;
        default: return 'P50T50';
    }
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
