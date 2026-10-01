// Binary data travels as base64 text in JSON (API, sockets, database).
export const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
// The URL-safe form (no padding), as WebAuthn names credentials.
export const toBase64Url = (bytes) => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
