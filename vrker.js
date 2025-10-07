cd $HOME
cat > stalker_local_config.js <<'EOF'
// stalker_local_config.js - Local Stalker → M3U proxy for Termux
// Edit the config block below

const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const config = {
  host: 'YOUR_PORTAL_HOST',       // e.g., 'tv.max4k.us'
  mac_address: '00:1A:79:00:06:D6',
  serial_number: '02ECB1334989A',
  device_id: 'F285A46190BF5A9AB2E987C5186976A208B2886C9B945294EC310F5572CDFDDD',
  device_id_2: 'F285A46190BF5A9AB2E987C5186976A208B2886C9B945294EC310F5572CDFDDD',
  stb_type: 'MAG250',
  api_signature: '263'
};

function logDebug(msg) {
  console.log(new Date().toISOString(), '-', msg);
}

function md5hex(str) {
  return crypto.createHash('md5').update(String(str)).digest('hex');
}

function generateHardwareVersionsSync() {
  config.hw_version = '1.7-BD-' + md5hex(config.mac_address).substring(0, 2).toUpperCase();
  config.hw_version_2 = md5hex((config.serial_number || '').toLowerCase() + (config.mac_address || '').toLowerCase());
}

function getHeaders(token = '') {
  const headers = {
    'Cookie': `mac=${config.mac_address}; stb_lang=en; timezone=GMT`,
    'Referer': `http://${config.host}/stalker_portal/c/`,
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
    'X-User-Agent': `Model: ${config.stb_type}; Link: WiFi`,
    'Accept': '*/*'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// Safe JSON parse helper
function safeParseText(text) {
  if (!text || typeof text !== 'string') return null;
  text = text.trim();
  const idx = text.search(/[\{\[]/);
  if (idx > 0) text = text.substring(idx);
  try { return JSON.parse(text); } catch(e){ return null; }
}

// Stalker API calls
async function getToken() {
  const url = `http://${config.host}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
  try {
    logDebug(`getToken -> ${url}`);
    const res = await fetch(url, { headers: getHeaders(), timeout: 15000 });
    const data = safeParseText(await res.text());
    return data?.js?.token || '';
  } catch (e) { logDebug('getToken error: '+e.message); return ''; }
}

async function auth(token) {
  const metrics = { mac: config.mac_address, model:'', type:'STB', uid:'', device:'', random:'' };
  const metricsEncoded = encodeURIComponent(JSON.stringify(metrics));
  const url = `http://${config.host}/stalker_portal/server/load.php?type=stb&action=get_profile`
    + `&hd=1&ver=ImageDescription:%200.2.18-r14-pub-250;`
    + `%20PORTAL%20version:%205.5.0;%20API%20Version:%20328;`
    + `&num_banks=2&sn=${config.serial_number}`
    + `&stb_type=${config.stb_type}&client_type=STB&image_version=218&video_out=hdmi`
    + `&device_id=${config.device_id}&device_id2=${config.device_id_2}`
    + `&signature=&auth_second_step=1&hw_version=${config.hw_version}`
    + `&not_valid_token=0&metrics=${metricsEncoded}`
    + `&hw_version_2=${config.hw_version_2}&api_signature=${config.api_signature}`
    + `&prehash=&JsHttpRequest=1-xml`;
  try { const res = await fetch(url, { headers:getHeaders(token), timeout:15000 }); return safeParseText(await res.text())?.js || []; }
  catch(e){ logDebug('auth error:'+e.message); return []; }
}

async function handShake(token) {
  const url = `http://${config.host}/stalker_portal/server/load.php?type=stb&action=handshake&token=${token}&JsHttpRequest=1-xml`;
  try { const res = await fetch(url, { headers:getHeaders(token), timeout:15000 }); return safeParseText(await res.text())?.js?.token || ''; }
  catch(e){ logDebug('handShake error:'+e.message); return ''; }
}

async function getAccountInfo(token) {
  const url = `http://${config.host}/stalker_portal/server/load.php?type=account_info&action=get_main_info&JsHttpRequest=1-xml`;
  try { const res = await fetch(url, { headers:getHeaders(token), timeout:15000 }); return safeParseText(await res.text())?.js || []; }
  catch(e){ logDebug('getAccountInfo error:'+e.message); return []; }
}

async function getGenres(token) {
  const url = `http://${config.host}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
  try { const res = await fetch(url, { headers:getHeaders(token), timeout:15000 }); return safeParseText(await res.text())?.js || []; }
  catch(e){ logDebug('getGenres error:'+e.message); return []; }
}

async function getStreamURL(id, token) {
  const url = `http://${config.host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=ffrt%20http://localhost/ch/${id}&JsHttpRequest=1-xml`;
  try { const res = await fetch(url, { headers:getHeaders(token), timeout:15000 }); return safeParseText(await res.text())?.js?.cmd || ''; }
  catch(e){ logDebug('getStreamURL error:'+e.message); return ''; }
}

async function genToken() {
  generateHardwareVersionsSync();
  const token0 = await getToken();
  if(!token0){ logDebug('genToken: empty'); return {token:'', profile:[], account_info:[]}; }
  const profile = await auth(token0);
  const token1 = await handShake(token0);
  if(!token1){ logDebug('genToken handshake empty'); return {token:'', profile, account_info:[]}; }
  const account_info = await getAccountInfo(token1);
  return { token: token1, profile, account_info };
}

function convertChannelsToM3U(channels, profile, account_info, req){
  const origin = `${req.protocol}://${req.get('host')}`;
  const m3u = ['#EXTM3U', `# Total Channels => ${channels.length}`, ''];
  channels.forEach((ch, idx)=>{
    const name = ch.name||'Unknown';
    let cmd = ch.cmd||'';
    const match = String(cmd).match(/\/ch\/(\d+)/);
    const chId = match ? match[1] : ch.id || ch.stream_id || '';
    const url = chId ? `${origin}/${encodeURIComponent(chId)}.m3u8`:'about:blank';
    const logo = ch.logo ? `http://${config.host}/stalker_portal/misc/logos/320/${ch.logo}` : '';
    m3u.push(`#EXTINF:-1 tvg-id="${ch.xmltv_id||''}" tvg-name="${name}" tvg-logo="${logo}" group-title="${ch.title||'Other'}",${name}`);
    m3u.push(url);
    if(idx<5) logDebug(`M3U #${idx}: ${name} -> ${url}`);
  });
  return m3u.join('\n');
}

// Express routes
app.get('/playlist.m3u8', async(req,res)=>{
  try{
    const {token, profile, account_info} = await genToken();
    if(!token) return res.status(500).send('Token generation failed');
    const chRes = await fetch(`http://${config.host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`,{headers:getHeaders(token), timeout:20000});
    const chData = safeParseText(await chRes.text());
    const channels = chData?.js?.data || [];
    const m3u = convertChannelsToM3U(channels, profile, account_info, req);
    res.set('Content-Type','application/vnd.apple.mpegurl');
    res.send(m3u);
  }catch(e){ logDebug('playlist error:'+e.message); res.status(500).send('Error generating playlist'); }
});

app.get('/:id.m3u8', async(req,res)=>{
  const id = req.params.id;
  if(!id) return res.status(400).send('Missing channel id');
  try{
    const {token} = await genToken();
    if(!token) return res.status(500).send('Token generation failed');
    const stream = await getStreamURL(id, token);
    if(!stream) return res.status(500).send('No stream returned');
    res.redirect(302, stream);
  }catch(e){ logDebug('stream error:'+e.message); res.status(500).send('Error fetching stream'); }
});

app.get('/status',(req,res)=>res.send('OK'));

const PORT = process.env.PORT||3000;
app.listen(PORT,()=>logDebug(`Stalker local proxy running at http://0.0.0.0:${PORT}`));
EOF
