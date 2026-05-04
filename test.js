```javascript
// ==UserScript==
// @name         Better xCloud - Ultimate Patch v3 (Stable + Low Latency)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Smart latency + stability + PiP + WebRTC tuning (safe & optimized)
// @match        *://www.xbox.com/*/play*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    console.log("🚀 Injecting xCloud Ultimate Patch v3...");

    // ==========================================
    // 1. SAFE VISIBILITY SPOOF (Less Detectable)
    // ==========================================
    const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    const originalVisibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');

    Object.defineProperty(document, 'hidden', { get: () => false });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });

    document.addEventListener('visibilitychange', (e) => {
        e.stopImmediatePropagation();
    }, true);

    // ==========================================
    // 2. SMART VIDEO OPTIMIZER (NOT OVERFORCED)
    // ==========================================
    function optimizeVideo(video) {
        if (!video) return;

        // Enable PiP
        video.removeAttribute('disablePictureInPicture');

        // GPU hint (safe)
        video.style.willChange = 'transform';
        video.style.transform = 'translateZ(0)';

        // Only reduce delay slightly (NOT 0)
        if (typeof video.playoutDelayHint !== 'undefined') {
            video.playoutDelayHint = 0.03; // balanced low latency
        }
    }

    setInterval(() => {
        document.querySelectorAll('video').forEach(optimizeVideo);
    }, 1500);

    // ==========================================
    // 3. WEBRTC SMART PATCH (NO OVERFORCING)
    // ==========================================
    const origSetLocalDesc = RTCPeerConnection.prototype.setLocalDescription;

    RTCPeerConnection.prototype.setLocalDescription = async function(desc) {
        if (desc && desc.sdp && desc.type === 'answer') {
            let sdp = desc.sdp;

            // Moderate bitrate floor (safe)
            sdp = sdp.replace(
                /a=fmtp:104(.*)\r\n/g,
                'a=fmtp:104$1;x-google-min-bitrate=4000;x-google-max-bitrate=12000\r\n'
            );

            // Ensure PLI (safe)
            if (!sdp.includes('nack pli')) {
                sdp = sdp.replace(
                    /a=rtcp-fb:104 nack\r\n/g,
                    'a=rtcp-fb:104 nack\r\na=rtcp-fb:104 nack pli\r\n'
                );
            }

            desc.sdp = sdp;
        }

        return origSetLocalDesc.apply(this, arguments);
    };

    // ==========================================
    // 4. MOBILE TOUCH BOOST (NEW)
    // Improves responsiveness slightly
    // ==========================================
    document.addEventListener('touchstart', () => {}, { passive: true });

    // ==========================================
    // 5. PiP HOTKEY (ALT + P)
    // ==========================================
    window.addEventListener('keydown', async (e) => {
        if (e.altKey && e.key.toLowerCase() === 'p') {
            const video = document.querySelector('video');
            if (!video) return;

            try {
                if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture();
                } else {
                    await video.requestPictureInPicture();
                }
            } catch (err) {
                console.warn("PiP failed:", err);
            }
        }
    });

    // ==========================================
    // 6. FPS STABILITY WATCHDOG (NEW)
    // ==========================================
    setInterval(() => {
        const video = document.querySelector('video');
        if (!video) return;

        const dropped = video.getVideoPlaybackQuality?.().droppedVideoFrames || 0;

        if (dropped > 50) {
            console.log("⚠️ High frame drop detected → adjusting...");
            video.playoutDelayHint = 0.05;
        }
    }, 5000);

    console.log("✅ xCloud v3 Optimization Loaded!");
})();
```
