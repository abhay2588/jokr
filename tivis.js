/**
 * final.js — Multi-Portal Termux server (FINAL) with runtime IP patch
 * Theme: Black + Neon Green
 *
 * NOTE: Only origin handling was adjusted to use the request host dynamically.
 */

const express = require('express');
const fetch = require('node-fetch'); // v2
const bodyParser = require('body-parser');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const PORT = 8080;
const BASE_DIR = __dirname;
const PORTALS_DIR = path.join(BASE_DIR, 'portals');
const ACTIVE_FILE = path.join(BASE_DIR, 'active_portal.json');

if (!fs.existsSync(PORTALS_DIR)) fs.mkdirSync(PORTALS_DIR, { recursive: true });

// Keep-alive agents
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 30 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 30 });

function fetchWithAgent(url, opts = {}) {
  opts.headers = opts.headers || {};
  const proto = String(url).startsWith('https:') ? 'https' : 'http';
  opts.agent = proto === 'https' ? httpsAgent : httpAgent;
  return fetch(url, opts);
}

/* ---------------------- Utilities ---------------------- */

function getNetworkInfo() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets || {})) {
    for (const net of nets[name] || []) {
      if (net && net.family === 'IPv4' && !net.internal) {
        const ip = net.address;
        let type = 'Local Network';
        if (ip.startsWith('192.168.43.')) type = 'Hotspot (Xiaomi/Redmi)';
        else if (ip.startsWith('192.168.137.')) type = 'Hotspot (Samsung)';
        else if (ip.startsWith('10.')) type = 'Hotspot (Vivo/iQOO/Realme)';
        else if (ip.startsWith('192.168.1.')) type = 'Wi-Fi (Home/Router)';
        return { ip, type };
      }
    }
  }
  return { ip: '127.0.0.1', type: 'Local' };
}
function safeStr(s) { return String(s || '').trim(); }
function esc(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'": '&#39;'}[m])); }
function escJs(s){ if(!s) return ''; return String(s).replace(/['"\\]/g, m => '\\' + m); }
function safePortalName(name) {
  if (!name) return null;
  return String(name).trim().replace(/[^a-zA-Z0-9_.\- ]/g, '_').replace(/\s+/g, '_');
}
function md5hex(s) {
  return crypto.createHash('md5').update(String(s || '')).digest('hex');
}
function makeUniqueFolder(displayName, host, mac, serial) {
  const safe = safePortalName(displayName || 'portal');
  const seed = `${host || ''}::${mac || ''}::${serial || ''}`;
  const hash = md5hex(seed).slice(0, 8);
  return `${safe}_${hash}`;
}
function ensurePortalFolder(folderName) {
  const folder = path.join(PORTALS_DIR, folderName);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return folder;
}
function readJSONSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('readJSONSafe error', e && e.message);
    return null;
  }
}
function writeJSONSafe(p, obj) {
  try {
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('writeJSONSafe error', e && e.message);
    return false;
  }
}
async function safeJSONResponse(res) {
  try {
    const text = await (res.text ? res.text() : Promise.resolve(''));
    try { return JSON.parse(text); } catch(e){ return { js: null, raw: text, error: true, status: res.status || 0 }; }
  } catch (e) {
    return { js: null, raw: '', error: true, status: 0 };
  }
}

/* ---------------------- Stalker helpers (per portal) ---------------------- */

async function generateHardwareVersions(cfg) {
  try {
    cfg.hw_version = '1.7-BD-' + md5hex(cfg.mac_address || '').substring(0,2).toUpperCase();
  } catch(e) { cfg.hw_version = '1.7-BD-00'; }
  try {
    cfg.hw_version_2 = md5hex(((cfg.serial_number || '') + (cfg.mac_address || '')).toLowerCase());
  } catch(e) { cfg.hw_version_2 = ''; }
}

function headersFor(cfg, token='') {
  const h = {
    'Cookie': `mac=${cfg.mac_address || ''}; stb_lang=en; timezone=GMT`,
    'Referer': `http://${cfg.host}/stalker_portal/c/`,
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp',
    'X-User-Agent': `Model: ${cfg.stb_type || 'MAG250'}; Link: WiFi`
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function portal_getToken(cfg) {
  const url = `http://${cfg.host}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
  try {
    const r = await fetchWithAgent(url, { headers: headersFor(cfg) });
    const j = await safeJSONResponse(r);
    return j?.js?.token || '';
  } catch (e) {
    console.error('portal_getToken error', e && e.message);
    return '';
  }
}

async function portal_auth(cfg, token) {
  const metrics = { mac: cfg.mac_address || '', model:'', type:'STB', uid:'', device:'', random:'' };
  const metricsEncoded = encodeURIComponent(JSON.stringify(metrics));
  const url = `http://${cfg.host}/stalker_portal/server/load.php?type=stb&action=get_profile` +
    `&hd=1&ver=ImageDescription:%200.2.18-r14-pub-250;&num_banks=2&sn=${cfg.serial_number || ''}` +
    `&stb_type=${cfg.stb_type || ''}&client_type=STB&image_version=218&video_out=hdmi` +
    `&device_id=${cfg.device_id || ''}&device_id2=${cfg.device_id_2 || ''}` +
    `&signature=&auth_second_step=1&hw_version=${cfg.hw_version || ''}` +
    `&not_valid_token=0&metrics=${metricsEncoded}` +
    `&hw_version_2=${cfg.hw_version_2 || ''}&api_signature=${cfg.api_signature || ''}` +
    `&prehash=&JsHttpRequest=1-xml`;
  try {
    const r = await fetchWithAgent(url, { headers: headersFor(cfg, token) });
    const j = await safeJSONResponse(r);
    return j?.js || {};
  } catch (e) {
    console.error('portal_auth error', e && e.message);
    return {};
  }
}

async function portal_handshake(cfg, token) {
  const url = `http://${cfg.host}/stalker_portal/server/load.php?type=stb&action=handshake&token=${token}&JsHttpRequest=1-xml`;
  try {
    const r = await fetchWithAgent(url, { headers: headersFor(cfg, token) });
    const j = await safeJSONResponse(r);
    return j?.js?.token || '';
  } catch (e) {
    console.error('portal_handshake error', e && e.message);
    return '';
  }
}

async function portal_getAllChannels(cfg, token) {
  const url = `http://${cfg.host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
  try {
    const r = await fetchWithAgent(url, { headers: headersFor(cfg, token) });
    const j = await safeJSONResponse(r);
    return j?.js?.data || [];
  } catch (e) {
    console.error('portal_getAllChannels error', e && e.message);
    return [];
  }
}

async function portal_getGenres(cfg, token) {
  const url = `http://${cfg.host}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
  try {
    const r = await fetchWithAgent(url, { headers: headersFor(cfg, token) });
    const j = await safeJSONResponse(r);
    return j?.js || [];
  } catch (e) {
    console.error('portal_getGenres error', e && e.message);
    return [];
  }
}

async function portal_createLink(cfg, id, token, cmdOverride=null) {
  // cmdOverride: custom command string like 'ffmpeg http://localhost/ch/ID' or null to use default ffrt
  const cmd = cmdOverride ? encodeURIComponent(cmdOverride) : encodeURIComponent(`ffrt http://localhost/ch/${id}`);
  const url = `http://${cfg.host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=${cmd}&JsHttpRequest=1-xml`;
  try {
    const r = await fetchWithAgent(url, { headers: headersFor(cfg, token) });
    const j = await safeJSONResponse(r);
    return j?.js?.cmd || '';
  } catch (e) {
    console.error('portal_createLink error', e && e.message);
    return '';
  }
}

async function portal_genTokenAndProfile(cfg) {
  await generateHardwareVersions(cfg);
  const t1 = await portal_getToken(cfg);
  if (!t1) { console.error('portal_genTokenAndProfile: failed initial token for', cfg.host); return { token:'', profile:{}, account_info:{} }; }
  const profile = await portal_auth(cfg, t1);
  const t2 = await portal_handshake(cfg, t1);
  const acc = await (async function(cfgLocal, t){ try { const url = `http://${cfgLocal.host}/stalker_portal/server/load.php?type=account_info&action=get_main_info&JsHttpRequest=1-xml`; const r = await fetchWithAgent(url, { headers: headersFor(cfgLocal, t) }); return (await safeJSONResponse(r))?.js || {}; } catch(e){ return {}; } })(cfg, t2);
  return { token: t2, profile: profile || {}, account_info: acc || {} };
}

/* ---------------------- M3U builder (uses origin passed by caller) ---------------------- */

async function convertChannelsToM3U(cfg, channels, profile, account_info, origin, portalFolderName) {
  // origin must be like "http://10.138.168.174:8080" or "http://localhost:8080"
  const out = ['#EXTM3U', `# Total Channels => ${channels.length}`, '# Script => local multi-portal server', ''];

  // Info placeholders — caller will insert the full info block (we keep minimal here)
  out.push(`#EXTINF:-1 tvg-name="Portal" group-title="Info",Portal • ${cfg.host || ''}`);
  out.push('https://tg-aadi.vercel.app/intro.m3u8');
  out.push(`#EXTINF:-1 tvg-name="ServerIP" group-title="Info",Server • ${profile?.ip || 'Unknown'}`);
  out.push('https://tg-aadi.vercel.app/intro.m3u8');

  for (let i=0;i<(channels||[]).length;i++){
    const ch = channels[i];
    const cmd = ch.cmd || '';
    let realID = cmd.replace('ffrt http://localhost/ch/', '');
    if (!realID) realID = ch.id || `unknown_${i}`;
    const logo = ch.logo ? `http://${cfg.host}/stalker_portal/misc/logos/320/${ch.logo}` : '';
    out.push(`#EXTINF:-1 tvg-id="${ch.tvgid || ''}" tvg-name="${(ch.name||'').replace(/,/g,' ')}" tvg-logo="${logo}" group-title="${ch.title || 'Other'}",${ch.name || 'Unknown'}`);
    out.push(`${origin}/portal/${encodeURIComponent(portalFolderName)}/${encodeURIComponent(realID)}.m3u8`);
    if (i<5) console.log(`M3U #${i}: ${ch.name} -> ${origin}/portal/${portalFolderName}/${realID}.m3u8`);
  }
  return out.join('\n');
}

/* ---------------------- Portal file helpers ---------------------- */

function setActivePortal(folderName) {
  try { fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ active: folderName }, null, 2), 'utf8'); return true; } catch(e){ console.error('setActivePortal error', e && e.message); return false; }
}
function getActivePortal() {
  try {
    if (!fs.existsSync(ACTIVE_FILE)) return null;
    const j = JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'));
    return j && j.active ? j.active : null;
  } catch(e){ return null; }
}

function loadPortalConfigByFolder(folder) {
  if (!folder) return null;
  const cfgPath = path.join(PORTALS_DIR, folder, 'config.json');
  if (!fs.existsSync(cfgPath)) return null;
  try {
    const c = JSON.parse(fs.readFileSync(cfgPath,'utf8'));
    // back-compat defaults
    if (c.adult_filter === undefined) c.adult_filter = true;
    if (c.low_latency === undefined) c.low_latency = false;
    c._folder = folder;
    return c;
  } catch(e){ return null; }
}

function listPortalFolders() {
  try {
    return fs.readdirSync(PORTALS_DIR, { withFileTypes:true }).filter(d=>d.isDirectory()).map(d=>d.name);
  } catch(e){ return []; }
}

/* ---------------------- Express app & UI ---------------------- */

const app = express();
app.use(bodyParser.urlencoded({ extended:true }));
app.use(bodyParser.json());

// Home UI - list & create portal
app.get('/', (req,res) => {
  const net = getNetworkInfo();
  const folders = listPortalFolders();
  const activeFolder = getActivePortal();
  const cards = folders.map(folder => {
    const cfg = loadPortalConfigByFolder(folder) || {};
    const hasSaved = fs.existsSync(path.join(PORTALS_DIR, folder, 'playlist.m3u8'));
    return { folder, display_name: cfg.display_name || folder, host: cfg.host || '', hasSaved, adult_filter: cfg.adult_filter, low_latency: cfg.low_latency };
  });

  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Multi-Portal Stalker → M3U</title>
  <style>
    body{background:#000;color:#0f0;font-family:monospace;padding:14px}
    .wrap{max-width:1000px;margin:0 auto}
    .card{border:1px solid rgba(0,255,0,0.06);padding:12px;border-radius:6px;margin-bottom:12px}
    input,button,select{background:#000;color:#0f0;border:1px solid #0f0;padding:8px;margin-top:6px;width:100%;border-radius:6px}
    .row{display:flex;gap:10px}
    .col{flex:1}
    a{color:#0f0;text-decoration:none}
    .small{color:#9f9;font-size:0.9em}
    .actions a{margin-left:8px}
    .btn{background:#062;padding:10px}
    .btn:hover{background:#0f0;color:#000}
  </style>
  <script>
    function delPortal(folder, name){ if(confirm('Delete portal '+name+' ?')) location='/portal_delete?folder='+encodeURIComponent(folder); }
    function editPortal(folder){ location='/portal_edit?folder='+encodeURIComponent(folder); }
    function viewPortal(folder){ location='/portal_view?folder='+encodeURIComponent(folder); }
    function selectPortal(folder){ fetch('/portal_select', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({folder:folder})}).then(()=>location='/'); }
  </script>
  </head><body><div class="wrap">
    <h2>Multi-Portal Stalker → M3U</h2>

    <div class="card">
      <h3>Create New Portal</h3>
      <form method="post" action="/portal_create">
        <div class="row"><div class="col"><label>Portal display name (custom)</label><input name="portal_name" placeholder="MyPortal" required></div></div>
        <div class="row"><div class="col"><label>Host (domain or ip:port)</label><input name="host" placeholder="tv.example.com"></div></div>
        <div class="row"><div class="col"><label>MAC address</label><input name="mac_address" placeholder="00:1A:79:XX:XX:XX"></div></div>
        <div class="row"><div class="col"><label>Serial number</label><input name="serial_number"></div></div>
        <div class="row"><div class="col"><label>Device ID</label><input name="device_id"></div><div class="col"><label>Device ID 2</label><input name="device_id_2"></div></div>
        <div class="row"><div class="col"><label>STB Type</label><input name="stb_type" value="MAG250"></div><div class="col"><label>EPG URL (optional)</label><input name="epg_url"></div></div>
        <div style="margin-top:10px"><button class="btn" type="submit">Create Portal</button></div>
      </form>
    </div>

    ${cards.length === 0 ? '<div class="card small">No portals yet</div>' : cards.map(c => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <b>${esc(c.display_name)}</b> <span class="small">(${esc(c.host||'no host')})</span>
            ${activeFolder === c.folder ? '<span class="small" style="color:#FF0"> • ACTIVE</span>' : ''}
          </div>
          <div class="actions">
            <a href="javascript:selectPortal('${escJs(c.folder)}')">Select</a>
            <a href="/portal_view?folder=${encodeURIComponent(c.folder)}">Open</a>
            <a href="/portal_edit?folder=${encodeURIComponent(c.folder)}">Edit</a>
            <a href="javascript:delPortal('${escJs(c.folder)}','${escJs(c.display_name)}')" style="color:#f88">Delete</a>
          </div>
        </div>
        <div style="margin-top:8px" class="small">
          ${c.hasSaved ? `<a href="/portal/${encodeURIComponent(c.folder)}/saved/playlist.m3u8">Saved playlist</a>` : 'No saved playlist yet'} • Folder: ${esc(c.folder)}
        </div>
        <div class="small">Adult: ${c.adult_filter ? 'ON' : 'OFF'} • LowLatency: ${c.low_latency ? 'ON' : 'OFF'}</div>
      </div>
    `).join('')}

    <div class="small">Network: ${esc(getNetworkInfo().type)} • IP: ${esc(getNetworkInfo().ip)} • Port: ${PORT}</div>
  </div></body></html>`);
});

/* ---------------------- Portal creation / edit / delete / select ---------------------- */

app.post('/portal_create', (req,res) => {
  const body = req.body || {};
  const displayName = safeStr(body.portal_name || '');
  if (!displayName) return res.status(400).send('Portal name required');

  const host = safeStr(body.host || '');
  const mac = safeStr(body.mac_address || '');
  const serial = safeStr(body.serial_number || '');
  const folderName = makeUniqueFolder(displayName, host, mac, serial);
  const folder = ensurePortalFolder(folderName);

  const cfg = {
    display_name: displayName,
    host,
    mac_address: mac,
    serial_number: serial,
    device_id: safeStr(body.device_id || ''),
    device_id_2: safeStr(body.device_id_2 || ''),
    stb_type: safeStr(body.stb_type || 'MAG250'),
    api_signature: safeStr(body.api_signature || '263'),
    epg_url: safeStr(body.epg_url || ''),
    adult_filter: true,    // default ON
    low_latency: false     // default OFF
  };

  writeJSONSafe(path.join(folder,'config.json'), cfg);

  if (!getActivePortal()) setActivePortal(folderName);

  return res.redirect('/');
});

app.get('/portal_view', (req,res) => {
  const folder = safeStr(req.query.folder || '');
  if (!folder) return res.status(400).send('Missing folder');
  const cfg = loadPortalConfigByFolder(folder);
  if (!cfg) return res.status(404).send('Not found');
  const saved = fs.existsSync(path.join(PORTALS_DIR, folder, 'playlist.m3u8'));
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Portal ${esc(cfg.display_name||folder)}</title></head><body style="background:#000;color:#0f0;font-family:monospace;padding:20px">
    <h3>Portal: ${esc(cfg.display_name||folder)}</h3>
    <pre style="color:#9f9">${esc(JSON.stringify(cfg, null, 2))}</pre>
    <div><a href="/playlist.m3u8">Preview Playlist (active portal)</a></div>
    <div style="margin-top:8px"><form method="post" action="/portal/${encodeURIComponent(folder)}/save"><button>Save Playlist (Manual)</button></form></div>
    <div style="margin-top:8px">${saved ? `<a href="/portal/${encodeURIComponent(folder)}/saved/playlist.m3u8">Open Saved</a> • <a href="/portal/${encodeURIComponent(folder)}/delete_saved">Delete Saved</a>` : 'No saved playlist'}</div>
    <p style="margin-top:12px"><a href="/">Back</a></p>
  </body></html>`);
});

app.get('/portal_edit', (req,res) => {
  const folder = safeStr(req.query.folder || '');
  if (!folder) return res.status(400).send('Missing folder');
  const cfg = loadPortalConfigByFolder(folder);
  if (!cfg) return res.status(404).send('Not found');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Edit ${esc(cfg.display_name||folder)}</title></head><body style="background:#000;color:#0f0;font-family:monospace;padding:20px">
    <h3>Edit Portal: ${esc(cfg.display_name||folder)}</h3>
    <form method="post" action="/portal_update">
      <input type="hidden" name="folder" value="${esc(folder)}">
      <label>Display Name:</label><input name="display_name" value="${esc(cfg.display_name||'')}" required><br>
      <label>Host:</label><input name="host" value="${esc(cfg.host||'')}" required><br>
      <label>MAC:</label><input name="mac_address" value="${esc(cfg.mac_address||'')}" ><br>
      <label>Serial:</label><input name="serial_number" value="${esc(cfg.serial_number||'')}" ><br>
      <label>Device ID:</label><input name="device_id" value="${esc(cfg.device_id||'')}" ><br>
      <label>Device ID2:</label><input name="device_id_2" value="${esc(cfg.device_id_2||'')}" ><br>
      <label>STB Type:</label><input name="stb_type" value="${esc(cfg.stb_type||'MAG250')}" ><br>
      <label>EPG URL (optional):</label><input name="epg_url" value="${esc(cfg.epg_url||'')}" ><br>
      <label>Adult Filter</label><br>
      <select name="adult_filter">
        <option value="on" ${cfg.adult_filter !== false ? "selected" : ""}>ON</option>
        <option value="off" ${cfg.adult_filter === false ? "selected" : ""}>OFF</option>
      </select><br><br>
      <label>Low Latency Mode</label><br>
      <select name="low_latency">
        <option value="on" ${cfg.low_latency === true ? "selected" : ""}>ON</option>
        <option value="off" ${cfg.low_latency === false ? "selected" : ""}>OFF</option>
      </select><br><br>
      <button>Save</button>
    </form>
    <p><a href="/">Back</a></p>
  </body></html>`);
});

app.post('/portal_update', (req,res) => {
  const body = req.body || {};
  const folder = safeStr(body.folder || '');
  if (!folder) return res.status(400).send('Missing');
  const folderPath = path.join(PORTALS_DIR, folder);
  if (!fs.existsSync(folderPath)) return res.status(404).send('Portal not found');

  const cfg = {
    display_name: safeStr(body.display_name || ''),
    host: safeStr(body.host || ''),
    mac_address: safeStr(body.mac_address || ''),
    serial_number: safeStr(body.serial_number || ''),
    device_id: safeStr(body.device_id || ''),
    device_id_2: safeStr(body.device_id_2 || ''),
    stb_type: safeStr(body.stb_type || 'MAG250'),
    api_signature: safeStr(body.api_signature || '263'),
    epg_url: safeStr(body.epg_url || ''),
    adult_filter: (body.adult_filter === 'off') ? false : true,
    low_latency: (body.low_latency === 'on') ? true : false
  };
  writeJSONSafe(path.join(folderPath,'config.json'), cfg);
  return res.redirect('/');
});

app.get('/portal_delete', (req,res) => {
  const folder = safeStr(req.query.folder || '');
  if (!folder) return res.status(400).send('Missing');
  const folderPath = path.join(PORTALS_DIR, folder);
  if (!fs.existsSync(folderPath)) return res.status(404).send('Not found');
  try {
    fs.rmSync(folderPath, { recursive:true, force:true });
    const active = getActivePortal();
    if (active === folder) setActivePortal(null);
    return res.redirect('/');
  } catch (e) {
    return res.status(500).send('Delete failed: ' + e.message);
  }
});

app.post('/portal_select', (req,res) => {
  const folder = (req.body && req.body.folder) ? safeStr(req.body.folder) : safeStr(req.query.folder || '');
  if (!folder) return res.status(400).send('Missing');
  const folderPath = path.join(PORTALS_DIR, folder);
  if (!fs.existsSync(folderPath)) return res.status(404).send('Portal not found');
  setActivePortal(folder);
  return res.json({ ok:true, active: folder });
});

/* ---------------------- Playlist preview & manual save (uses request host as origin) ---------------------- */

app.get('/playlist.m3u8', async (req,res) => {
  try {
    const activeFolder = getActivePortal();
    if (!activeFolder) return res.status(400).send('No active portal selected');
    const cfg = loadPortalConfigByFolder(activeFolder);
    if (!cfg) return res.status(404).send('Active portal config missing');

    // determine origin from requester host (dynamic)
    const requestHost = (req.headers.host || `localhost:${PORT}`).split(':')[0];
    const origin = `http://${requestHost}:${PORT}`;

    const { token, profile, account_info } = await portal_genTokenAndProfile(cfg);
    if (!token) return res.status(500).send('Token generation failed');

    const channels = await portal_getAllChannels(cfg, token);
    const genres = await portal_getGenres(cfg, token);
    const gmap = {}; (genres||[]).forEach(g=>{ if(g && g.id) gmap[g.id]=g.title; });
    let mapped = (channels||[]).map(item=>({
      name: item.name || 'Unknown',
      cmd: item.cmd || '',
      tvgid: item.xmltv_id || '',
      id: item.tv_genre_id || '',
      logo: item.logo || '',
      title: gmap[item.tv_genre_id] || 'Other'
    }));

    // Apply adult filter only if enabled in portal config
    if (cfg.adult_filter !== false) {
      mapped = mapped.filter(c=>!(c.title||'').toLowerCase().startsWith('adult'));
    }

    let m3u = await convertChannelsToM3U(cfg, mapped, profile, account_info, origin, activeFolder);

    // Build full INFO BLOCK (created, expire, days left, tariff, max_online, server_ip, user_ip)
    const created     = profile?.created || "Unknown";
    const expire      = account_info?.end_date || "Unknown";
    const tariff      = account_info?.tariff_plan || "Unknown";
    const server_ip   = profile?.ip || "Unknown";
    const max_online  = profile?.storages ? Object.values(profile.storages)[0]?.max_online || "Unknown" : "Unknown";

    const user_ip = req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.connection?.remoteAddress || requestHost || 'Unknown';

    let days_left = "Unknown";
    try {
      const now = new Date();
      const expiry = new Date(expire);
      if (!isNaN(expiry.getTime())) {
        const diff = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        days_left = diff >= 0 ? diff + " days left" : "Expired";
      }
    } catch (_) {}

    const infoBlock =
`#EXTINF:-1 tvg-name="PortalHost" group-title="Portal | Info",Portal • ${cfg.host || ''}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="ServerIP" group-title="Portal | Info",Server IP • ${server_ip}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="UserIP" group-title="Portal | Info",User IP • ${user_ip}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="Created" group-title="Portal | Info",Created • ${created}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="Expire" group-title="Portal | Info",Expire • ${expire}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="DaysLeft" group-title="Portal | Info",${days_left}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="Tariff" group-title="Portal | Info",Tariff • ${tariff}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="MaxOnline" group-title="Portal | Info",Max Online • ${max_online}
https://tg-aadi.vercel.app/intro.m3u8
`;

    // Insert infoBlock after #EXTM3U
    m3u = m3u.replace('#EXTM3U', `#EXTM3U\n${infoBlock}`);

    res.setHeader('Content-Type','application/vnd.apple.mpegurl');
    res.send(m3u);
  } catch (e) {
    console.error('playlist preview error', e && e.message);
    res.status(500).send('Preview failed: ' + (e && e.message));
  }
});

// Manual save for portal (writes playlist.m3u8 into portal folder) — uses requester host as origin
app.post('/portal/:portal/save', async (req,res) => {
  const portal = safeStr(req.params.portal || '');
  if (!portal) return res.status(400).send('Missing portal');
  const cfg = loadPortalConfigByFolder(portal);
  if (!cfg) return res.status(404).send('Portal not found');
  try {
    // determine origin from requester host (dynamic)
    const requestHost = (req.headers.host || `localhost:${PORT}`).split(':')[0];
    const origin = `http://${requestHost}:${PORT}`;

    const { token, profile, account_info } = await portal_genTokenAndProfile(cfg);
    if (!token) return res.status(500).send('Token generation failed');
    const channels = await portal_getAllChannels(cfg, token);
    const genres = await portal_getGenres(cfg, token);
    const gmap = {}; (genres||[]).forEach(g=>{ if(g && g.id) gmap[g.id]=g.title; });
    let mapped = (channels||[]).map(item=>({
      name: item.name || 'Unknown',
      cmd: item.cmd || '',
      tvgid: item.xmltv_id || '',
      id: item.tv_genre_id || '',
      logo: item.logo || '',
      title: gmap[item.tv_genre_id] || 'Other'
    }));
    if (cfg.adult_filter !== false) {
      mapped = mapped.filter(c=>!(c.title||'').toLowerCase().startsWith('adult'));
    }
    let m3u = await convertChannelsToM3U(cfg, mapped, profile, account_info, origin, portal);

    // Info block same as preview
    const created     = profile?.created || "Unknown";
    const expire      = account_info?.end_date || "Unknown";
    const tariff      = account_info?.tariff_plan || "Unknown";
    const server_ip   = profile?.ip || "Unknown";
    const max_online  = profile?.storages ? Object.values(profile.storages)[0]?.max_online || "Unknown" : "Unknown";
    const user_ip = req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.connection?.remoteAddress || requestHost || 'Unknown';

    let days_left = "Unknown";
    try {
      const now = new Date();
      const expiry = new Date(expire);
      if (!isNaN(expiry.getTime())) {
        const diff = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        days_left = diff >= 0 ? diff + " days left" : "Expired";
      }
    } catch (_) {}

    const infoBlock =
`#EXTINF:-1 tvg-name="PortalHost" group-title="Portal | Info",Portal • ${cfg.host || ''}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="ServerIP" group-title="Portal | Info",Server IP • ${server_ip}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="UserIP" group-title="Portal | Info",User IP • ${user_ip}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="Created" group-title="Portal | Info",Created • ${created}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="Expire" group-title="Portal | Info",Expire • ${expire}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="DaysLeft" group-title="Portal | Info",${days_left}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="Tariff" group-title="Portal | Info",Tariff • ${tariff}
https://tg-aadi.vercel.app/intro.m3u8
#EXTINF:-1 tvg-name="MaxOnline" group-title="Portal | Info",Max Online • ${max_online}
https://tg-aadi.vercel.app/intro.m3u8
`;
    m3u = m3u.replace('#EXTM3U', `#EXTM3U\n${infoBlock}`);

    const folder = ensurePortalFolder(portal);
    fs.writeFileSync(path.join(folder,'playlist.m3u8'), m3u, 'utf8');
    const meta = { saved_at: new Date().toISOString(), host: cfg.host || '', config: cfg };
    writeJSONSafe(path.join(folder,'meta.json'), meta);
    console.log(`Saved playlist for portal ${portal}`);
    return res.redirect(`/portal_view?folder=${encodeURIComponent(portal)}`);
  } catch (e) {
    console.error('save playlist error', e && e.message);
    return res.status(500).send('Save failed: ' + (e && e.message));
  }
});

/* ---------------------- Serve saved playlist for a portal (runtime host rewrite) ---------------------- */

app.get('/portal/:portal/saved/:file', (req,res) => {
  const portal = safeStr(req.params.portal || '');
  const file = path.basename(req.params.file || '');
  if (!portal || !file) return res.status(400).send('Missing');
  const p = path.join(PORTALS_DIR, portal, file);
  if (!fs.existsSync(p)) return res.status(404).send('Not found');

  try {
    let content = fs.readFileSync(p,'utf8');

    // Determine the request host (host:port may be present). Use only hostname part.
    const requestHost = (req.headers.host || `localhost:${PORT}`).split(':')[0];
    const requestOrigin = `http://${requestHost}:${PORT}`;

    // Replace any previously embedded origins (http://<any>:PORT) with the current request origin.
    // This is a simple regex that targets "http://<something>:<PORT>"
    const regex = new RegExp(`http:\\/\\/[^:\\/\\n\\r]+:${PORT}`, 'gi');
    content = content.replace(regex, requestOrigin);

    res.setHeader('Content-Type','application/vnd.apple.mpegurl');
    res.send(content);
  } catch (e) {
    console.error('serve saved playlist error', e && e.message);
    res.status(500).send('Serve saved failed: ' + (e && e.message));
  }
});

// Delete saved playlist
app.get('/portal/:portal/delete_saved', (req,res) => {
  const portal = safeStr(req.params.portal || '');
  const folder = path.join(PORTALS_DIR, portal);
  const playlist = path.join(folder, 'playlist.m3u8');
  const meta = path.join(folder, 'meta.json');
  if (!fs.existsSync(playlist)) return res.status(404).send('No saved playlist');
  try {
    fs.unlinkSync(playlist);
    if (fs.existsSync(meta)) fs.unlinkSync(meta);
    return res.redirect('/');
  } catch (e) { return res.status(500).send('Delete failed: '+e.message); }
});

// Download meta.json
app.get('/portal/:portal/meta', (req,res) => {
  const portal = safeStr(req.params.portal || '');
  const meta = path.join(PORTALS_DIR, portal, 'meta.json');
  if (!fs.existsSync(meta)) return res.status(404).send('Not found');
  res.download(meta, `${portal}_meta.json`);
});

/* ---------------------- Portal-specific stream route ---------------------- */

app.get('/portal/:portal/:id.m3u8', async (req,res) => {
  const portal = safeStr(req.params.portal || '');
  const idRaw = req.params.id || '';
  const id = decodeURIComponent(idRaw);
  const cfg = loadPortalConfigByFolder(portal);
  if (!cfg) return res.status(404).send('Portal config not found');

  try {
    const { token } = await portal_genTokenAndProfile(cfg);
    if (!token) return res.status(500).send('Token failed');

    // Low-latency: try faster commands first if enabled
    let stream = '';
    if (cfg.low_latency === true) {
      const tries = [
        `auto ${id}`,
        `ffmpeg http://localhost/ch/${id}`,
        `ffrt http://localhost/ch/${id}`
      ];
      for (const t of tries) {
        stream = await portal_createLink(cfg, id, token, t);
        if (stream) break;
      }
    }
    // fallback to default
    if (!stream) stream = await portal_createLink(cfg, id, token, null);
    if (!stream) return res.status(500).send('No stream URL received');

    stream = stream.replace(/^ffrt\s+/i, '').trim();

    if (!/^https?:\/\//i.test(stream)) {
      if (stream.startsWith('//')) stream = 'http:' + stream;
      else if (stream.startsWith('/')) stream = `http://${cfg.host}${stream}`;
    }

    // Prefetch small range to warm cache if low latency enabled
    if (cfg.low_latency === true) {
      try { fetchWithAgent(stream, { method:'GET', headers:{ Range:'bytes=0-4095' } }).catch(()=>{}); } catch(_) {}
    }

    return res.redirect(302, stream);
  } catch (e) {
    console.error('portal stream error', e && e.message);
    return res.status(500).send('Stream redirect failed: ' + (e && e.message));
  }
});

/* ---------------------- Root-level stream (active portal) ---------------------- */

app.get('/:id.m3u8', async (req,res) => {
  const idRaw = req.params.id || '';
  const id = decodeURIComponent(idRaw);
  const active = getActivePortal();
  if (!active) return res.status(400).send('No active portal selected');
  const cfg = loadPortalConfigByFolder(active);
  if (!cfg) return res.status(404).send('Active portal config missing');

  try {
    const { token } = await portal_genTokenAndProfile(cfg);
    if (!token) return res.status(500).send('Token failed');

    let stream = '';
    if (cfg.low_latency === true) {
      const tries = [`auto ${id}`, `ffmpeg http://localhost/ch/${id}`, `ffrt http://localhost/ch/${id}`];
      for (const t of tries) {
        stream = await portal_createLink(cfg, id, token, t);
        if (stream) break;
      }
    }
    if (!stream) stream = await portal_createLink(cfg, id, token, null);
    if (!stream) return res.status(500).send('No stream URL received');

    stream = stream.replace(/^ffrt\s+/i, '').trim();
    if (!/^https?:\/\//i.test(stream)) {
      if (stream.startsWith('//')) stream = 'http:' + stream;
      else if (stream.startsWith('/')) stream = `http://${cfg.host}${stream}`;
    }

    if (cfg.low_latency === true) {
      try { fetchWithAgent(stream, { method:'GET', headers:{ Range:'bytes=0-4095' } }).catch(()=>{}); } catch(_) {}
    }

    return res.redirect(302, stream);
  } catch (e) {
    console.error('stream redirect error', e && e.message);
    return res.status(500).send('Stream redirect failed: ' + (e && e.message));
  }
});

/* ---------------------- Misc / fallback ---------------------- */

app.get('/health', (req,res) => res.send('ok'));
app.all(/.*/, (req,res) => res.status(404).send('Unknown route'));

/* ---------------------- Startup ---------------------- */

function ensureActivePortalOnStartup() {
  const folders = listPortalFolders();
  if (fs.existsSync(ACTIVE_FILE)) return;
  if (folders.length) setActivePortal(folders[0]);
  else writeJSONSafe(ACTIVE_FILE, { active: null });
}

app.listen(PORT, async () => {
  ensureActivePortalOnStartup();
  const net = getNetworkInfo();
  console.log('\n=============================================');
  console.log('   ✔ Multi-Portal Server Running (final.js)');
  console.log('=============================================');
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`LAN:   http://${net.ip}:${PORT}  (${net.type})`);
  console.log('=============================================\n');
});
