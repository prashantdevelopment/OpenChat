// Safety number: lets two people check that nobody sits in the middle.
//
// Each person gets the other's public key from the server. A malicious server
// could hand out its own key instead and read everything (man-in-the-middle).
// Both people compute this number from the two public keys; if the numbers
// they see match (compared in person or on a call), the keys are the real ones.
import { fromBase64 } from "./base64.js";

const DOMAIN = "openchat/safety-number/v1";
const GROUPS = 12;
const BYTES_PER_GROUP = 5; // 40 bits, safe as a JavaScript number

// Returns 12 groups of 5 digits, e.g. "04213 99812 ...". The same for both
// people: the keys are sorted, so their order doesn't matter.
export const computeSafetyNumber = async (publicKeyA, publicKeyB) => {
  const [first, second] = [publicKeyA, publicKeyB].sort();
  const input = new Uint8Array([
    ...new TextEncoder().encode(DOMAIN),
    ...fromBase64(first),
    ...fromBase64(second),
  ]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", input)); // 64 bytes

  const groups = [];
  for (let group = 0; group < GROUPS; group++) {
    let value = 0;
    for (let i = 0; i < BYTES_PER_GROUP; i++) {
      value = value * 256 + digest[group * BYTES_PER_GROUP + i];
    }
    groups.push(String(value % 100000).padStart(5, "0"));
  }
  return groups.join(" ");
};
