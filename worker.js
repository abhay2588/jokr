// work.js - Cloudflare Worker
// Stalker Portal → M3U Generator
// Patched for full flow: handshake → profile → channels → M3U

export default {
  async fetch(request, env, ctx) {
    try {
      const portalUrl = "http://iptv.initv.de/stalker_portal/c"; // 👈 must end with /c/
      const macAddress = "00:1A:79:61:2D:BB"; // 👈 replace with real MAC
      const deviceId = "76C8FF8575442448A774C2E59098C02D0C209486B0FA9064CB193B7DC28789ED";    // 👈 fixed, not random
      const sn = "56EB7FA68778C";              // 👈 fixed serial

      // Step 1: Handshake → token
      const token = await generateToken(portalUrl, macAddress, deviceId, sn);

      // Step 2: Auth profile
      await getProfile(portalUrl, token, macAddress);

      // Step 3: Channels
      const channels = await getChannels(portalUrl, token, macAddress);

      // Step 4: Build M3U
      const m3u = buildM3U(channels, portalUrl, token, macAddress);

      return new Response(m3u, {
        headers: {
          "Content-Type": "application/x-mpegurl; charset=utf-8",
          "Content-Disposition": "attachment; filename=playlist.m3u"
        },
      });

    } catch (err) {
      return new Response(`❌ Worker error:\n${err.message}`, {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    }
  }
};

// 🔑 Handshake
async function generateToken(portalUrl, macAddress, deviceId, sn) {
  const response = await fetch(`${portalUrl}server/load.php`, {
    method: "POST",
    headers: stalkerHeaders(portalUrl, macAddress),
    body: new URLSearchParams({
      type: "stb",
      action: "handshake",
      token: "",
      JsHttpRequest: "1-xml",
      device_id: deviceId,
      sn: sn,
    }),
  });

  const raw = await response.text();
  console.log("🔎 Handshake response:", raw);

  let data;
  try { data = JSON.parse(raw); } 
  catch { throw new Error("Handshake: Not JSON\n" + raw); }

  if (!data.js || !data.js.token) {
    throw new Error("Token generation failed.\nRaw:\n" + raw);
  }

  return data.js.token;
}

// 👤 Profile auth
async function getProfile(portalUrl, token, macAddress) {
  const response = await fetch(`${portalUrl}server/load.php?type=stb&action=get_profile&JsHttpRequest=1-xml`, {
    headers: stalkerHeaders(portalUrl, macAddress, token),
  });
  const raw = await response.text();
  console.log("🔎 Profile response:", raw);
  return raw;
}

// 📺 Get channel list
async function getChannels(portalUrl, token, macAddress) {
  const response = await fetch(`${portalUrl}server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`, {
    headers: stalkerHeaders(portalUrl, macAddress, token),
  });
  const raw = await response.text();
  console.log("🔎 Channels response:", raw);

  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error("Channels: Not JSON\n" + raw); }

  if (!data.js || !data.js.data) {
    throw new Error("Channel list failed.\nRaw:\n" + raw);
  }

  return data.js.data;
}

// 📝 Build M3U playlist
function buildM3U(channels, portalUrl, token, macAddress) {
  let m3u = "#EXTM3U\n";
  for (const ch of channels) {
    const name = ch.name || "NoName";
    const logo = ch.logo || "";
    const cmd = ch.cmd || "";

    // Final stream URL
    const streamUrl = `${portalUrl}server/load.php?type=itv&action=create_link&cmd=${encodeURIComponent(cmd)}&JsHttpRequest=1-xml&token=${token}`;

    m3u += `#EXTINF:-1 tvg-id="" tvg-logo="${logo}" group-title="${ch.tv_genre || ''}",${name}\n`;
    m3u += `${streamUrl}\n`;
  }
  return m3u;
}

// 🧾 Headers
function stalkerHeaders(portalUrl, mac, token = "") {
  return {
    "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) stbapp ver: 4 rev: Stalker Middleware 5",
    "X-User-Agent": "Model: MAG254; Link: Ethernet",
    "Referer": portalUrl,
    "Accept": "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "Cookie": `mac=${mac}; stb_lang=en; timezone=GMT`,
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
  };
}
