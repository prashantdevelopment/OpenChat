import api from "../api/api.js";

// Shared by 1:1 calls (CallProvider) and group calls (GroupCallProvider).

// How the browsers find each other: the server hands out STUN (each
// browser's public address) and, when configured, TURN relay credentials for
// networks that can't connect directly (server: iceServers.service.js). If
// the server can't be asked, public STUN alone still works on many networks.
const FALLBACK_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
export const loadIceServers = () =>
  api
    .get("/calls/ice-servers")
    .then((res) => res.data.iceServers)
    .catch(() => FALLBACK_ICE_SERVERS);

export const CAMERA = { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } };

// One call at a time, 1:1 or group: a group call in progress makes an
// incoming 1:1 call "busy" (the 1:1 side is known through useCall()).
export const groupCallState = { active: false };
