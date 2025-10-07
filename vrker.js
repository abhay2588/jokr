// Stalker-Portal To M3U Generator Script (Termux Ready)
// Author: @tg_aadi
// Telegram: https://t.me/tg_aadi
// Dependencies: express, node-fetch@2

const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

// ============ CONFIGURATION ============
const config = {
    host: '', // Your Stalker-Portal host (e.g., 'example.com')
    mac_address: '', // Your MAC address
    serial_number: '', // Your serial number
    device_id: '', // Your device_id
    device_id_2: '', // Your device_id_2
    stb_type: 'MAG250', // Stb type
    api_signature: '263',
};

// ================== HELPERS ==================
function logDebug(msg) {
    console.log(`${new Date().toISOString()} - ${msg}`);
}

function getHeaders(token = '') {
    const headers = {
        'Cookie': `mac=${config.mac_address}; stb_lang=en; timezone=GMT`,
        'Referer': `http://${config.host}/stalker_portal/c/`,
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'X-User-Agent': `Model: ${config.stb_type}; Link: WiFi`
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

async function getToken() {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
    try {
        const res = await fetch(url, { headers: getHeaders() });
        const data = await res.json();
        return data.js?.token || '';
    } catch (e) {
        logDebug(`Error in getToken: ${e.message}`);
        return '';
    }
}

async function auth(token) {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=stb&action=get_profile&num_banks=2&sn=${config.serial_number}&stb_type=${config.stb_type}&device_id=${config.device_id}&device_id2=${config.device_id_2}&hw_version=1.7&hw_version_2=1.7&api_signature=${config.api_signature}&JsHttpRequest=1-xml`;
    try {
        const res = await fetch(url, { headers: getHeaders(token) });
        const data = await res.json();
        return data.js || [];
    } catch (e) {
        logDebug(`Error in auth: ${e.message}`);
        return [];
    }
}

async function getAllChannels(token) {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
    try {
        const res = await fetch(url, { headers: getHeaders(token) });
        const data = await res.json();
        return data.js?.data || [];
    } catch (e) {
        logDebug(`Error fetching channels: ${e.message}`);
        return [];
    }
}

async function getStreamURL(id, token) {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=ffrt%20http://localhost/ch/${id}&JsHttpRequest=1-xml`;
    try {
        const res = await fetch(url, { headers: getHeaders(token) });
        const data = await res.json();
        return data.js?.cmd || '';
    } catch (e) {
        logDebug(`Error fetching stream URL: ${e.message}`);
        return '';
    }
}

function convertChannelsToM3U(channels, origin) {
    let m3u = ['#EXTM3U', '# Script: @tg_aadi', ''];
    channels.forEach(ch => {
        const channelUrl = `${origin}/${ch.id}.m3u8`;
        m3u.push(`#EXTINF:-1 tvg-name="${ch.name}" tvg-logo="${ch.logo || ''}" group-title="${ch.title || 'Other'}",${ch.name}`);
        m3u.push(channelUrl);
    });
    return m3u.join('\n');
}

// ================== EXPRESS ROUTES ==================
app.get('/playlist.m3u8', async (req, res) => {
    logDebug('Generating playlist...');
    const token = await getToken();
    if (!token) return res.status(500).send('Failed to retrieve token');

    const profile = await auth(token);
    const channels = await getAllChannels(token);

    const origin = `${req.protocol}://${req.hostname}:${PORT}`;
    const m3uContent = convertChannelsToM3U(channels, origin);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(m3uContent);
});

app.get('/:channelId.m3u8', async (req, res) => {
    const channelId = req.params.channelId;
    const token = await getToken();
    if (!token) return res.status(500).send('Failed to retrieve token');

    const streamURL = await getStreamURL(channelId, token);
    if (!streamURL) return res.status(500).send('Stream not found');

    res.redirect(streamURL);
});

// ================== START SERVER ==================
app.listen(PORT, () => {
    logDebug(`Stalker local proxy running at http://127.0.0.1:${PORT}`);
});
