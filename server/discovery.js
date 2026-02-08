const onvif = require('node-onvif');

let discoveredDevices = {};

async function autoDiscovery() {
    console.log('Starting Auto Discovery...');
    try {
        const devices = await onvif.startProbe();
        console.log(`Found ${devices.length} devices.`);

        devices.forEach((info) => {
            // Extract MAC/ID to use as Key
            // Panasonic often puts MAC in UDN or we can query it.
            // For now, use UDN or generate ID from IP.
            const id = info.urn.split(':').pop();

            discoveredDevices[id] = {
                id: id,
                ip: info.xaddrs[0].split('/')[2].split(':')[0], // Extract IP from xaddrs
                name: info.name,
                type: 'Panasonic PTZ', // Assume for now or query device info
                lastSeen: Date.now()
            };
            console.log(`Discovered: ${info.name} at ${discoveredDevices[id].ip}`);
        });

        return discoveredDevices;
    } catch (e) {
        console.error('Discovery Error:', e);
        return {};
    }
}

module.exports = { autoDiscovery, discoveredDevices };
