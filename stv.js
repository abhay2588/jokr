/**
 * hybrid_v9_master.js — LEVEL 5: STICKY SESSIONS & TOKEN VAULT
 * Maps specific players to specific MACs. Caches handshake tokens to prevent ban spam.
 */

const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = 8080;
const BASE_DIR = __dirname;
const PORTALS_DIR = path.join(BASE_DIR, 'portals');

if (!fs.existsSync(PORTALS_DIR)) fs.mkdirSync(PORTALS_DIR, { recursive: true });

// --- THE 3 ADVANCED CACHES ---
const FAILURE_CACHE = {}; // Tracks Banned MACs
const TOKEN_VAULT = {};   // Saves Handshake Tokens so we don't spam the server
const CLIENT_MAP = {};    // Locks Player A to MAC 1, Player B to MAC 2

const FAILURE_TTL = 30000; 

function resolveClientRef(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/mac=([^;]+)/);
    return match ? match[1] : req.ip;
}

function getAvailableProfile(profiles, folder, clientRef) {
    const now = Date.now();
    const mapKey = `${folder}_${clientRef}`;
    
    // 1. Check if this player is already locked to a healthy MAC
    const assignedMac = CLIENT_MAP[mapKey];
    if (assignedMac) {
        const p = profiles.find(x => x.mac === assignedMac);
        if (p && (!FAILURE_CACHE[`${folder}_${assignedMac}`] || FAILURE_CACHE[`${folder}_${assignedMac}`] < now)) {
            return p; // Keep using the locked MAC
        }
    }

    // 2. If no lock, or MAC was banned, find the next healthy MAC
    for (let p of profiles) {
        if (!FAILURE_CACHE[`${folder}_${p.mac}`] || FAILURE_CACHE[`${folder}_${p.mac}`] < now) {
            CLIENT_MAP[mapKey] = p.mac; // Lock the player to this new MAC
            console.log(`🔗 [ROUTER] Locked Player (${clientRef}) to Real MAC (${p.mac})`);
            return p;
        }
    }
    return null;
}

function benchMac(mac, folder) {
    console.log(`\n❌ [BANNED] Portal rejected MAC ${mac}. Benching for 30s & clearing tokens...`);
    FAILURE_CACHE[`${folder}_${mac}`] = Date.now() + FAILURE_TTL;
    delete TOKEN_VAULT[`${folder}_${mac}`]; // Destroy bad token
}

// --- HELPER FUNCTIONS ---
function safeStr(s) { return String(s || '').trim(); }
function safePortalName(name) { return name ? String(name).trim().replace(/[^a-zA-Z0-9_.\- ]/g, '_').replace(/\s+/g, '_') : null; }
function md5hex(s) { return crypto.createHash('md5').update(String(s || '')).digest('hex'); }
function makeUniqueFolder(displayName, host) { return `${safePortalName(displayName || 'portal')}_${md5hex(`${host||''}`).slice(0, 8)}`; }
function ensurePortalFolder(folderName) { const f = path.join(PORTALS_DIR, folderName); if (!fs.existsSync(f)) fs.mkdirSync(f, { recursive: true }); return f; }
function writeJSONSafe(p, obj) { try { fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); return true; } catch (e) { return false; } }

function getProfiles(cfg) {
    if (cfg.profiles && cfg.profiles.length > 0) return cfg.profiles;
    let macs = [];
    if (cfg.mac_addresses && cfg.mac_addresses.length > 0) macs = cfg.mac_addresses;
    else if (cfg.mac_address) macs = cfg.mac_address.split(/[,\n]/).map(m=>m.trim()).filter(Boolean);
    else return [{mac: '00:00:00:00:00:00', sn: cfg.serial_number||'', d1: cfg.device_id||'', d2: cfg.device_id_2||''}];
    return macs.map(m => ({ mac: m, sn: cfg.serial_number||'', d1: cfg.device_id||'', d2: cfg.device_id_2||'' }));
}

function loadPortalConfig(folder) { if (!folder) return null; try { const c = JSON.parse(fs.readFileSync(path.join(PORTALS_DIR, folder, 'config.json'),'utf8')); c._folder = folder; return c; } catch(e){ return null; } }
function listPortalFolders() { try { return fs.readdirSync(PORTALS_DIR, { withFileTypes:true }).filter(d=>d.isDirectory()).map(d=>d.name); } catch(e){ return []; } }

// --- UPDATED AUTH ENGINE FOR MAG270 ---
async function getAuthHeaders(cfg, macProfile, folder) {
    const mac = macProfile.mac;
    const vaultKey = `${folder}_${mac}`;
    
    // MAG 270 Emulation
    const headers = {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG270 stbapp',
        'X-User-Agent': `Model: MAG270; Link: WiFi`,
        'Cookie': `mac=${mac}; stb_lang=en; timezone=GMT;`
    };

    if (TOKEN_VAULT[vaultKey]) {
        headers['Authorization'] = `Bearer ${TOKEN_VAULT[vaultKey]}`;
        return headers;
    }

    try {
        const hsRes = await fetch(`http://${cfg.host}/stalker_portal/server/load.php?type=stb&action=handshake`, { headers });
        const hsText = await hsRes.text();
        
        let hsData;
        try { 
            hsData = JSON.parse(hsText); 
            const token = hsData?.js?.token;
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        } catch (e) { /* Fallback */ }

        // Hardware Binding
        const profileUrl = `http://${cfg.host}/stalker_portal/server/load.php?type=stb&action=get_profile&sn=${macProfile.sn || ''}&device_id=${macProfile.d1 || ''}&device_id2=${macProfile.d2 || ''}`;
        await fetch(profileUrl, { headers });

        console.log(`✅ [AUTH] Session Built as MAG270 for ${mac}`);
        return headers;
    } catch (e) {
        return headers; 
    }
}

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- 1. WEBUI DASHBOARD ROUTES ---
app.get('/', (req,res) => {
  const folders = listPortalFolders();
  const cards = folders.map(folder => {
    const cfg = loadPortalConfig(folder) || {};
    return { folder, display_name: cfg.display_name || folder, host: cfg.host || '', macCount: getProfiles(cfg).length };
  });

  res.send(`<!doctype html><html><head><title>Hybrid Cluster Dashboard</title>
  <style>body{background:#000;color:#0f0;font-family:monospace;padding:14px}.card{border:1px solid rgba(0,255,0,0.2);padding:12px;margin-bottom:12px}input,button,textarea{background:#111;color:#0f0;border:1px solid #0f0;padding:8px;margin-top:6px;width:100%}a{color:#0f0;text-decoration:none}</style>
  </head><body>
    <h2>⚡ Level 5: Sticky Sessions</h2>
    <div class="card">
      <form method="post" action="/portal_create">
        <input name="portal_name" placeholder="Name (e.g. JioTV)" required>
        <input name="host" placeholder="tv.com">
        <textarea name="mac_data" rows="4" placeholder="MAC | SN | ID1 | ID2"></textarea>
        <button type="submit">Create New Portal Cluster</button>
      </form>
    </div>
    ${cards.map(c => `<div class="card">
        <b>${c.display_name}</b> [${c.macCount} MACs in Rotation Pool]<br><br>
        <i>TiviMate Proxy Link (STB Mode):</i> <input type="text" value="http://${req.hostname}:${PORT}/${c.folder}/c/" readonly><br>
        <i>Smart M3U Link (Other Apps):</i> <input type="text" value="http://${req.hostname}:${PORT}/playlist.m3u8?folder=${c.folder}" readonly><br><br>
        <a href="/portal_delete?folder=${c.folder}" style="color:#f55;">Delete Cluster</a>
    </div>`).join('')}
  </body></html>`);
});

app.post('/portal_create', (req,res) => {
  const body = req.body || {};
  const lines = safeStr(body.mac_data).split('\n').filter(Boolean);
  const profiles = lines.map(l => {
      const p = l.split('|').map(x=>x.trim());
      return { mac: p[0], sn: p[1]||'', d1: p[2]||'', d2: p[3]||'' };
  }).filter(p => p.mac);
  const folderName = makeUniqueFolder(body.portal_name, body.host);
  const folder = ensurePortalFolder(folderName);
  const cfg = { display_name: body.portal_name, host: safeStr(body.host), profiles: profiles, stb_type: 'MAG250' };
  writeJSONSafe(path.join(folder,'config.json'), cfg);
  res.redirect('/');
});

app.get('/portal_delete', (req,res) => { fs.rmSync(path.join(PORTALS_DIR, req.query.folder), { recursive:true }); res.redirect('/'); });


// --- 2. MULTI-TENANT STALKER PROXY ---
app.get(['/:folder/c', '/:folder/c/'], (req, res) => res.send('<html><body><h1>Stalker Proxy Active</h1></body></html>'));

app.all('/:folder/stalker_portal/server/load.php', async (req, res) => {
    const folder = req.params.folder;
    const clientRef = resolveClientRef(req); 
    
    const cfg = loadPortalConfig(folder);
    if (!cfg || !cfg.profiles || cfg.profiles.length === 0) return res.status(500).send('Portal ID not found');
    
    const activeProfile = getAvailableProfile(cfg.profiles, folder, clientRef);
    if (!activeProfile) return res.status(503).send("All MACs rate-limited");

    const targetUrl = `http://${cfg.host}/stalker_portal/server/load.php${req.url.substring(req.url.indexOf('?'))}`;
    
    const options = {
        method: req.method,
        headers: {
            'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp',
            'Cookie': `mac=${activeProfile.mac}; stb_lang=en; timezone=GMT;`,
            'Connection': 'keep-alive'
        }
    };

    // If TiviMate natively passes a token, vault it!
    if (req.headers['authorization']) {
        options.headers['Authorization'] = req.headers['authorization'];
        TOKEN_VAULT[`${folder}_${activeProfile.mac}`] = req.headers['authorization'].replace('Bearer ', '');
    } else if (TOKEN_VAULT[`${folder}_${activeProfile.mac}`]) {
        options.headers['Authorization'] = `Bearer ${TOKEN_VAULT[`${folder}_${activeProfile.mac}`]}`;
    }

    if (req.method === 'POST' && req.body) {
        const params = new URLSearchParams();
        for (const key in req.body) params.append(key, req.body[key]);
        options.body = params;
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    try {
        const portalResponse = await fetch(targetUrl, options);
        const dataText = await portalResponse.text();
        
        if (dataText.includes('Authorization failed') || dataText.includes('blocked')) {
            benchMac(activeProfile.mac, folder); 
        }

        res.setHeader('Content-Type', portalResponse.headers.get('content-type') || 'application/json');
        res.send(dataText);
    } catch (e) { res.status(500).send('Proxy Error'); }
});


// --- 3. SMART M3U & DEBOUNCE ENGINE ---
const debounceTimers = {}; 

app.get('/play', async (req, res) => {
    const folder = req.query.folder;
    const channelId = req.query.ch;
    const clientRef = req.ip; 

    if (debounceTimers[clientRef]) {
        clearTimeout(debounceTimers[clientRef].timer);
        debounceTimers[clientRef].res.status(404).end(); 
    }
    
    debounceTimers[clientRef] = {
        res: res,
        timer: setTimeout(async () => {
            delete debounceTimers[clientRef];
            const cfg = loadPortalConfig(folder);
            
            const activeProfile = getAvailableProfile(cfg.profiles, folder, clientRef);
            if (!activeProfile) return res.status(503).send("All MACs rate-limited");

            try {
                const authHeaders = await getAuthHeaders(cfg, activeProfile, folder);
                const linkUrl = `http://${cfg.host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=${channelId}`;
                const response = await fetch(linkUrl, { headers: authHeaders });
                const textData = await response.text();

                let data;
                try { data = JSON.parse(textData); } 
                catch (e) { benchMac(activeProfile.mac, folder); return res.status(500).send("HTML Ban"); }
                
                if (data.js && data.js.cmd) res.redirect(302, data.js.cmd.split(' ')[0]);
                else { benchMac(activeProfile.mac, folder); res.status(500).send("No Link"); }
            } catch (e) { benchMac(activeProfile.mac, folder); res.status(500).send("Error"); }
        }, 1500) 
    };
});

app.get('/playlist.m3u8', async (req, res) => {
    const folder = req.query.folder;
    const clientRef = req.ip;
    const cfg = loadPortalConfig(folder);

    if (!cfg || !cfg.profiles || !cfg.profiles[0]) {
        return res.status(404).send('Portal not found');
    }

    const activeProfile = getAvailableProfile(cfg.profiles, folder, clientRef);
    if (!activeProfile) return res.status(503).send("All MACs benched.");

    try {
        const authHeaders = await getAuthHeaders(cfg, activeProfile, folder);

        const chRes = await fetch(`http://${cfg.host}/stalker_portal/server/load.php?type=itv&action=get_all_channels`, { headers: authHeaders });
        const chText = await chRes.text();

        let chData;
        try {
            chData = JSON.parse(chText);
        } catch (e) {
            benchMac(activeProfile.mac, folder);
            return res.status(500).send("Portal rejected request.");
        }

        if (!chData.js || !chData.js.data) {
            benchMac(activeProfile.mac, folder);
            return res.status(500).send("Portal rejected request");
        }

        const catMap = {};
        if (chData.js.categories) {
            chData.js.categories.forEach(cat => {
                catMap[cat.id] = cat.title.replace(/,/g, '');
            });
        }

        let m3u = "#EXTM3U\n";

        chData.js.data.forEach(ch => {
            if (!ch.cmd) return;

            const safeName = ch.name ? ch.name.replace(/,/g, '') : 'Unknown Channel';
            const groupName = catMap[ch.category_id] || "Uncategorized";
            const logo = ch.logo || '';

            m3u += `#EXTINF:-1 tvg-id="${ch.id}" tvg-logo="${logo}" group-title="${groupName}",${safeName}\n`;
            m3u += `http://${req.hostname}:${PORT}/play?folder=${folder}&ch=${encodeURIComponent(ch.cmd)}\n`;
        });

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(m3u);

    } catch (e) {
        benchMac(activeProfile.mac, folder);
        res.status(500).send("Error generating playlist");
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 LEVEL 5: STICKY SESSIONS RUNNING 🚀`);
    console.log(`- Dashboard: http://localhost:${PORT}`);
});
