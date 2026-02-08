const axios = require('axios');
const http = require('http');

// Global Watchdog Timer
let watchdogTimer = null;

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
        const dev = devices[cmd.target]; // Target by MAC or ID
        if (dev) targets.push(dev);
    }

    // 3. Convert Action to Panasonic CGI
    const cgiParams = mapCommandToCgi(cmd.action, cmd.speed || 50);

    // 4. Send HTTP Requests
    const promises = targets.map(device => {
        const url = `http://${device.ip}/cgi-bin/aw_ptz?cmd=%23${cgiParams}&res=1`;
        console.log(`Sending to ${device.ip}: ${url}`);
        return axios.get(url, { timeout: 2000 }).catch(e => console.error(`Error sending to ${device.ip}:`, e.message));
    });

    await Promise.all(promises);
}

function resetWatchdog(devices) {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
        console.log("Watchdog Triggered: Stopping All Cameras");
        stopAllCameras(devices);
    }, 600); // Slightly more than 500ms to allow network jitter
}

async function stopAllCameras(devices) {
    // Panasonic STOP command usually is Pan/Tilt Stop or Preset Stop
    // Often sending P50T50 (Center speed 50 = Stop) works, or specific stop command depending on model.
    // Standard PTZ Stop: %23PTS50 or similar.
    // Let's use Pan/Tilt Stop: #P50T50 (Speed 50 is stop for Panasonic)

    const targets = Object.values(devices);
    const promises = targets.map(device => {
        // Panasonic: P50 T50 is neutral (stop)
        const url = `http://${device.ip}/cgi-bin/aw_ptz?cmd=%23P50T50&res=1`;
        // Also stop Zoom if needed per model, but usually separate. 
        // Let's assume P/T is main concern.
        return axios.get(url, { timeout: 1000 }).catch(e => { });
    });
    await Promise.all(promises);
}

function mapCommandToCgi(action, speed) {
    // Simplify Speed (0-100), Panasonic usually 01-99
    // Center is 50.
    // Pan Left: < 50, Pan Right: > 50

    // Simple Mapping for prototype
    switch (action) {
        case 'PAN_LEFT': return 'P01';
        case 'PAN_RIGHT': return 'P99';
        case 'TILT_UP': return 'T99';
        case 'TILT_DOWN': return 'T01';
        case 'ZOOM_IN': return 'Z99';
        case 'ZOOM_OUT': return 'Z01';
        case 'STOP': return 'P50T50Z50';
        // Presets: #Rxx (Recall), #Mxx (Memory/Set)
        case 'PRESET_CALL': return `R${String(speed).padStart(2, '0')}`;
        case 'PRESET_SET': return `M${String(speed).padStart(2, '0')}`;
        default: return 'P50T50';
    }
}

module.exports = { sendPtzCommand };
