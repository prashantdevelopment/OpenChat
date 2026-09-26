// Encrypted data (keys, messages) arrives as base64 text. The server cannot
// read it, but it can check that it is well-formed and the right size.
export const isBase64 = (value) => typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
export const base64Length = (value) => Buffer.from(value, "base64").length;
