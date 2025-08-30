// Stalker-Portal → M3U Generator (hardened)
// Author credits kept: @tg_aadi

// ---------- CONFIG (defaults; can be overridden by query params) ----------
const config = {
  host: '',               // portal.elite4k.co OR http://portal.elite4k.co
  mac_address: '',        // 00:1A:79:00:56:47
  serial_number: '',      // BE2956BA552B4
  device_id: '',          // E4FB9CDE13677D678BD99F2B9755A256E434FC309933113D7A4047DD03868386
  device_id_2: '',        // 9CDE13677D678BD99F2B9755A256E434FC309933113D7A4047DD03868386
  stb_type: 'MAG250',
  api_signature: '263',
  hw_version: '',
  hw_version_2: ''
};

// ---------- Utilities ----------
function logDebug(msg) { console.log(`${new Date().toISOString()} - ${msg}`); }
const cleanJson = (t) => {
  // Some portals return BOM or HTML around the JSON; try to rescue it.
  const start = t.indexOf('{"js"');
  if (start >= 0) {
    const slice = t.slice(start);
    // cut after last closing brace to avoid trailing junk
    const end = slice.lastIndexOf('}');
    return JSON.parse(slice.slice(0, end + 1));
  }
  // As a fallback, try regular parse (will throw)
  return JSON.parse(t);
};
async function md5(s) {
  const data = new TextEncoder().encode(s);
  const dig = await crypto.subtle.digest('MD5', data);
  return [...new Uint8Array(dig)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function normalizeBase(host) {
  // host can be "example.com" or "http(s)://example.com[/stalker_portal]"
  let base = host.trim();
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  // strip trailing slashes
  base = base.replace(/\/+$/,'');
  // ensure /stalker_portal present only once when we build URLs
  return base;
}
function headers(token = '') {
  const h = {
    'Cookie': `mac=${CONFIG.mac_address}; stb_lang=en; timezone=GMT`,
    'Referer': `${BASE}/stalker_portal/c/`,
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
    'X-User-Agent': `Model: ${CONFIG.stb_type}; Link: WiFi`,
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9'
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}
async function ensureHardwareVersions() {
  if (!CONFIG.hw_version) {
    CONFIG.hw_version = '1.7-BD-' + (await md5(CONFIG.mac_address)).slice(0,2).toUpperCase();
  }
  if (!CONFIG.hw_version_2) {
    CONFIG.hw_version_2 = await md5((CONFIG.serial_number || '').toLowerCase() + (CONFIG.mac_address || '').toLowerCase());
  }
}
function requireFields() {
  const missing = [];
  for (const k of ['host','mac_address','serial_number','device_id','device_id_2','stb_type']) {
    if (!CONFIG[k] || String(CONFIG[k]).trim() === '') missing.push(k);
  }
  return missing;
}

// ---------- Network helpers ----------
async function getToken() {
  const url = `${BASE}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
  logDebug(`getToken → ${url}`);
  const r = await fetch(url, { headers: headers() });
  const body = await r.text();
  logDebug(`getToken status=${r.status} body[0..200]=${body.slice(0,200)}`);
  if (!r.ok) throw new Error(`handshake HTTP ${r.status}`);
  const data = cleanJson(body);
  return data?.js?.token || '';
}
async function handshake(token) {
  const url = `${BASE}/stalker_portal/server/load.php?type=stb&action=handshake&token=${encodeURIComponent(token)}&JsHttpRequest=1-xml`;
  logDebug(`handshake(token) → ${url}`);
  const r = await fetch(url, { headers: headers() });
  const body = await r.text();
  logDebug(`handshake status=${r.status} body[0..200]=${body.slice(0,200)}`);
  if (!r.ok) throw new Error(`handshake2 HTTP ${r.status}`);
  const data = cleanJson(body);
  return data?.js?.token || '';
}
async function auth(token) {
  const metrics = encodeURIComponent(JSON.stringify({
    mac: CONFIG.mac_address, model:'', type:'STB', uid:'', device:'', random:''
  }));
  const url = `${BASE}/stalker_portal/server/load.php?type=stb&action=get_profile`
    + `&hd=1&ver=ImageDescription:%200.2.18-r14-pub-250;%20PORTAL%20version:%205.5.0;%20API%20Version:%20328;`
    + `&num_banks=2&sn=${CONFIG.serial_number}`
    + `&stb_type=${CONFIG.stb_type}&client_type=STB&image_version=218&video_out=hdmi`
    + `&device_id=${CONFIG.device_id}&device_id2=${CONFIG.device_id_2}`
    + `&signature=&auth_second_step=1&hw_version=${CONFIG.hw_version}`
    + `&not_valid_token=0&metrics=${metrics}`
    + `&hw_version_2=${CONFIG.hw_version_2}&api_signature=${CONFIG.api_signature}`
    + `&prehash=&JsHttpRequest=1-xml`;
  logDebug(`auth → ${url.slice(0,180)}...`);
  const r = await fetch(url, { headers: headers(token) });
  const body = await r.text();
  logDebug(`auth status=${r.status} body[0..200]=${body.slice(0,200)}`);
  if (!r.ok) throw new Error(`auth HTTP ${r.status}`);
  const data = cleanJson(body);
  return data?.js || {};
}
async function getAccountInfo(token) {
  const url = `${BASE}/stalker_portal/server/load.php?type=account_info&action=get_main_info&JsHttpRequest=1-xml`;
  const r = await fetch(url, { headers: headers(token) });
  const body = await r.text();
  logDebug(`account_info status=${r.status} body[0..160]=${body.slice(0,160)}`);
  if (!r.ok) throw new Error(`account_info HTTP ${r.status}`);
  const data = cleanJson(body);
  return data?.js || {};
}
async function getGenres(token) {
  const url = `${BASE}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
  const r = await fetch(url, { headers: headers(token) });
  const body = await r.text();
  if (!r.ok) throw new Error(`get_genres HTTP ${r.status}`);
  const data = cleanJson(body);
  return data?.js || [];
}
async function getAllChannels(token) {
  const url = `${BASE}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
  const r = await fetch(url, { headers: headers(token) });
  const body = await r.text();
  logDebug(`channels status=${r.status}`);
  if (!r.ok) throw new Error(`channels HTTP ${r.status} :: ${body.slice(0,200)}`);
  const data = cleanJson(body);
  return data?.js?.data || [];
}
async function createStreamLink(id, token) {
  const url = `${BASE}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=ffrt%20http://localhost/ch/${id}&JsHttpRequest=1-xml`;
  const r = await fetch(url, { headers: headers(token) });
  const body = await r.text();
  if (!r.ok) throw new Error(`create_link HTTP ${r.status}`);
  const data = cleanJson(body);
  return data?.js?.cmd || '';
}

// ---------- Flow ----------
let BASE = '';   // computed from CONFIG.host
let CONFIG = { ...config };

function applyQueryOverrides(u) {
  const q = u.searchParams;
  if (q.get('host')) CONFIG.host = q.get('host');
  if (q.get('mac')) CONFIG.mac_address = q.get('mac');
  if (q.get('sn')) CONFIG.serial_number = q.get('sn');
  if (q.get('did')) CONFIG.device_id = q.get('did');
  if (q.get('did2')) CONFIG.device_id_2 = q.get('did2');
  if (q.get('stb')) CONFIG.stb_type = q.get('stb');
}

async function genToken() {
  await ensureHardwareVersions();
  const t1 = await getToken();
  if (!t1) return { token:'', profile:{}, account_info:{} };
  const profile = await auth(t1);
  const t2 = await handshake(t1);
  if (!t2) return { token:'', profile, account_info:{} };
  const account_info = await getAccountInfo(t2);
  return { token: t2, profile, account_info };
}

function makeM3U(channels, profile, account_info, origin, req) {
  const m3u = [];
  m3u.push('#EXTM3U');
  m3u.push(`# Total Channels => ${channels.length}`);
  m3u.push('# Script => @tg_aadi','');

  const addInfo = (name, val, logo) => {
    m3u.push(`#EXTINF:-1 tvg-name="${name}" tvg-logo="${logo}" group-title="Portal | Info",${name} • ${val}`);
    m3u.push('https://tg-aadi.vercel.app/intro.m3u8');
  };

  addInfo('IP', profile.ip || 'Unknown', 'https://img.icons8.com/?size=160&id=OWj5Eo00EaDP&format=png');
  addInfo('Telegram: @tg_aadi', '@tg_aadi', 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Telegram_logo.svg/1024px-Telegram_logo.svg.png?20220101141644');
  addInfo('User IP', (req.headers.get('CF-Connecting-IP') || 'Unknown'), 'https://uxwing.com/wp-content/themes/uxwing/download/location-travel-map/ip-location-color-icon.svg');
  addInfo('Portal', CONFIG.host, 'https://upload.wikimedia.org/wikipedia/commons/6/6f/IPTV.png?20180223064625');
  addInfo('Created', profile.created || 'Unknown', 'https://cdn-icons-png.flaticon.com/128/1048/1048953.png');
  addInfo('End date', (account_info.end_date || 'Unknown'), 'https://www.citypng.com/public/uploads/preview/hand-drawing-clipart-14-feb-calendar-icon-701751694973910ds70zl0u9u.png');
  addInfo('Tariff Plan', (account_info.tariff_plan || 'Unknown'), 'https://img.lovepik.com/element/45004/5139.png_300.png');

  let max_online = 'Unknown';
  if (profile.storages && Object.keys(profile.storages).length) {
    const first = Object.values(profile.storages)[0];
    max_online = first?.max_online || 'Unknown';
  }
  addInfo('Max Connection', max_online, 'https://thumbs.dreamstime.com/b/people-vector-icon-group-symbol-illustration-businessman-logo-multiple-users-silhouette-153484048.jpg?w=1600');

  for (const ch of channels) {
    const real = (ch.cmd || '').replace('ffrt http://localhost/ch/', '') || 'unknown';
    const logo = ch.logo ? `${BASE}/stalker_portal/misc/logos/320/${ch.logo}` : '';
    m3u.push(`#EXTINF:-1 tvg-id="${ch.xmltv_id || ch.tvgid || ''}" tvg-name="${ch.name}" tvg-logo="${logo}" group-title="${ch.title || 'Other'}",${ch.name}`);
    m3u.push(`${origin}/${real}.m3u8`);
  }
  return m3u.join('\n');
}

// ---------- Worker ----------
addEventListener('fetch', (event) => event.respondWith(handleRequest(event.request)));

async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    CONFIG = { ...config };                // reset to defaults each request
    applyQueryOverrides(url);
    const debug = url.searchParams.get('debug') === '1';

    // validate config
    const miss = requireFields();
    if (miss.length) {
      const msg = `Missing required config: ${miss.join(', ')}`;
      logDebug(msg);
      return new Response(msg, { status: 400 });
    }

    BASE = normalizeBase(CONFIG.host);
    await ensureHardwareVersions();

    // get a working token/profile/account
    const { token, profile, account_info } = await genToken();
    if (!token) {
      const msg = 'Token generation failed';
      logDebug(msg);
      if (debug) return new Response(msg + ' (enable correct host/mac/sn/did/did2).', { status: 500 });
      return new Response(msg, { status: 500 });
    }

    const path = url.pathname;
    const last = path.split('/').pop() || '';

    if (path === '/playlist.m3u8') {
      const channels = await getAllChannels(token);
      const genres = await getGenres(token);
      const map = {};
      for (const g of genres) map[g.id] = g.title || 'Other';
      const channelsTagged = channels.map(it => ({
        ...it,
        title: map[it.tv_genre_id] || 'Other'
      }));
      const body = makeM3U(channelsTagged, profile, account_info, url.origin, request);
      return new Response(body, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
    }

    // /12345.m3u8 → redirect to real stream
    if (last.endsWith('.m3u8') && last !== 'playlist.m3u8') {
      const id = last.replace(/\.m3u8$/, '');
      if (!id) return new Response('Missing channel id', { status: 400 });
      const stream = await createStreamLink(id, token);
      if (!stream) return new Response('No stream URL received', { status: 502 });
      return Response.redirect(stream, 302);
    }

    return new Response('Not Found', { status: 404 });
  } catch (e) {
    logDebug(`Fatal: ${e.stack || e.message}`);
    return new Response(`Internal Server Error: ${e.message}`, { status: 500 });
  }
    }
