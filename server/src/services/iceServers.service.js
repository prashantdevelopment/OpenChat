import { TURN } from "../config/env.js";

// The servers a browser uses to find a way to the other person for a call
// (WebRTC ICE). STUN tells a browser its public address, enough when the two
// can reach each other directly. When they can't (the same router that won't
// loop traffic back, strict mobile or office networks), a TURN server relays
// the call; it only ever sees encrypted audio and video (DTLS-SRTP).
//
// TURN is Cloudflare Realtime TURN when its key is configured: the key's
// token stays on this server, and each call gets short-lived credentials.
const STUN_ONLY = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

// How long the credentials work: longer than any call.
const CREDENTIAL_TTL_SECONDS = 4 * 60 * 60;

// Browsers block port 53, and those addresses would only time out.
const usable = (url) => !/:53(\?|$)/.test(url);

const getIceServers = async () => {
    if (!TURN) return STUN_ONLY;
    try {
        const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${TURN.keyId}/credentials/generate-ice-servers`, {
            method: "POST",
            headers: { Authorization: `Bearer ${TURN.apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`Cloudflare TURN answered ${res.status}`);
        const { iceServers } = await res.json();
        const servers = (Array.isArray(iceServers) ? iceServers : [iceServers])
            .map((server) => ({ ...server, urls: [server.urls].flat().filter(usable) }))
            .filter((server) => server.urls.length > 0);
        return servers.length > 0 ? servers : STUN_ONLY;
    } catch (err) {
        // A call can still connect directly: never fail it because of this.
        console.error("TURN credentials unavailable, using STUN only:", err.message);
        return STUN_ONLY;
    }
};

export { getIceServers };
