// Stalker-Portal To M3U Generator Script
// Created by: @tg_aadi 
// Telegram: https://t.me/tg_aadi
// This script is free for everyone to use
// If you encounter issues, check the console logs for debug information

// ⚙ INSTRUCTIONS FOR USERS ⚙
// Update the 'config' object below with your Stalker-Portal details
// Access the generated M3U playlist by visiting: <your-deployment-url>/playlist.m3u8

// ============ ⚙ CONFIGURATION ============
const config = {
    host: 'jiotv.be', // Replace with your Stalker-Portal host (e.g., 'example.com')
    mac_address: '00:1A:79:BC:9F:0F', // Replace with your MAC address
    serial_number: 'F363035770EA1', // Replace with your serial number
    device_id: '172C9CE34A758605A8FED4F8C80A259DABC2003731D5B8DB25AEB82D7838C75F', // Replace with your device_id
    device_id_2: '172C9CE34A758605A8FED4F8C80A259DABC2003731D5B8DB25AEB82D7838C75F', // Replace with your device_id_2
    stb_type: 'MAG250', // Replace with Stalker-Portal Stb_type
    api_signature: '263', // No need to change
};

// Auto-generate hw_version & hw_version_2
async function generateHardwareVersions() {
    config.hw_version = '1.7-BD-' + (await hash(config.mac_address)).substring(0, 2).toUpperCase();
    config.hw_version_2 = await hash(config.serial_number.toLowerCase() + config.mac_address.toLowerCase());
}

async function hash(str) {
    const data = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('MD5', data);
    return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('');
}

function logDebug(message) {
    console.log(`${new Date().toISOString()} - ${message}`);
}

function getHeaders(token = '') {
    const headers = {
        'Cookie': `mac=${config.mac_address}; stb_lang=en; timezone=GMT`,
        'Referer': `http://${config.host}/stalker_portal/c/`,
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'X-User-Agent': `Model: ${config.stb_type}; Link: WiFi`
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

async function getToken() {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
    try {
        logDebug(`Fetching token from ${url}`);
        const response = await fetch(url, { headers: getHeaders() });
        logDebug(`getToken response status: ${response.status}`);
        if (!response.ok) {
            logDebug(`getToken failed with status: ${response.status} ${response.statusText}`);
            return '';
        }
        const text = await response.text();
        logDebug(`getToken response (first 500 chars): ${text.substring(0, 500)}`);
        const data = JSON.parse(text);
        const token = data.js?.token || '';
        logDebug(`Extracted token: ${token ? 'Success' : 'Empty'}`);
        return token;
    } catch (e) {
        logDebug(`Error in getToken: ${e.message}`);
        return '';
    }
}

async function getGenres(token) {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
    try {
        logDebug(`Fetching genres from ${url}`);
        const response = await fetch(url, { headers: getHeaders(token) });
        logDebug(`getGenres response status: ${response.status}`);
        if (!response.ok) {
            logDebug(`getGenres failed with status: ${response.status} ${response.statusText}`);
            return [];
        }
        const text = await response.text();
        logDebug(`getGenres response (first 500 chars): ${text.substring(0, 500)}`);
        const data = JSON.parse(text);
        logDebug(`Fetched genres data`);
        return data.js || [];
    } catch (e) {
        logDebug(`Error in getGenres: ${e.message}`);
        return [];
    }
}

async function getStreamURL(id, token) {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=ffrt%20http://localhost/ch/${id}&JsHttpRequest=1-xml`;
    try {
        logDebug(`Fetching stream URL for channel ID: ${id}`);
        const response = await fetch(url, { headers: getHeaders(token) });
        logDebug(`getStreamURL response status: ${response.status}`);
        if (!response.ok) {
            logDebug(`getStreamURL failed with status: ${response.status} ${response.statusText}`);
            return '';
        }
        const text = await response.text();
        logDebug(`getStreamURL response (first 500 chars): ${text.substring(0, 500)}`);
        const data = JSON.parse(text);
        const stream = data.js?.cmd || '';
        logDebug(`Stream URL: ${stream ? 'Success' : 'Empty'}`);
        return stream;
    } catch (e) {
        logDebug(`Error in getStreamURL: ${e.message}`);
        return '';
    }
}

async function genToken() {
    await generateHardwareVersions();
    const token = await getToken();
    if (!token) {
        logDebug('Failed to retrieve initial token');
        return { token: '', profile: [], account_info: [] };
    }
    const profile = await auth(token);
    const newToken = await handShake(token);
    if (!newToken) {
        logDebug('Failed to retrieve new token');
        return { token: '', profile, account_info: [] };
    }
    const account_info = await getAccountInfo(newToken);
    return { token: newToken, profile, account_info };
}

// =============================================== Express Server =======================================================
const express = require('express');
const app = express();
const PORT = 3000;

app.get('/playlist.m3u8', async (req, res) => {
    try {
        const { token, profile, account_info } = await genToken();
        if (!token) {
            res.status(500).send('Token generation failed');
            return;
        }

        const channelsUrl = `http://${config.host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
        const response = await fetch(channelsUrl, { headers: getHeaders(token) });
        const channelsData = await response.json();

        const m3u = [];
        m3u.push('#EXTM3U');

        channelsData.js.data.forEach(channel => {
            m3u.push(`#EXTINF:-1 tvg-id="${channel.xmltv_id}" tvg-name="${channel.name}" group-title="Channels", ${channel.name}`);
            m3u.push(`http://localhost/ch/${channel.id}.m3u8`);
        });

        res.type('application/vnd.apple.mpegurl').send(m3u.join('\n'));
    } catch (error) {
        console.log(error);
        res.status(500).send('Error generating M3U');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
