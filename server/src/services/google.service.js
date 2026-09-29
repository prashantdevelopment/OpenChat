import { createHash, createHmac, randomBytes } from "crypto";
import JWT from "jsonwebtoken";
import User, { isAllowedUsername } from "../models/user.model.js";
import { GOOGLE, JWT_SECRET } from "../config/env.js";
import AppError from "../utils/AppError.js";

// Sign in with Google: OAuth 2.0 authorization code flow with PKCE, the
// OpenID Connect way. No Google script runs on our pages: the browser goes to
// Google, Google sends it back to /api/auth/google/callback with a one-time
// code, and this server swaps the code for an ID token directly with Google
// over HTTPS (so the token needs no signature check of its own, OIDC 3.1.3.7).
// Protections: `state` (the callback belongs to a login started here: no
// login CSRF), PKCE (a stolen code is useless), `nonce` (the ID token was
// made for this login), and the token's audience, issuer, expiry and
// verified email are checked.

const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const FLOW_MINUTES = 10; // start → callback
const PENDING_MINUTES = 15; // callback → finishing sign-up or linking

// Short-lived tokens for the steps in between ride in httpOnly cookies. They
// are signed with their own key derived from JWT_SECRET, so one can never be
// taken for a login session (or the other way round).
const flowKey = createHmac("sha256", JWT_SECRET).update("openchat/google-flow").digest();
const signStep = (claims, minutes) => JWT.sign(claims, flowKey, { algorithm: "HS256", expiresIn: `${minutes}m` });
const verifyStep = (token, kind) => {
    if (typeof token !== "string" || !token) return null;
    try {
        const claims = JWT.verify(token, flowKey, { algorithms: ["HS256"] });
        return claims.kind === kind ? claims : null;
    } catch {
        return null;
    }
};

const base64url = (bytes) => bytes.toString("base64url");

export const googleEnabled = () => Boolean(GOOGLE);

// Step 1: where to send the browser, and the cookie that remembers this login
// (and whether to keep the person logged in afterwards).
export const startGoogleLogin = ({ remember = true } = {}) => {
    if (!GOOGLE) throw new AppError("Sign in with Google is not available", 404);
    const state = base64url(randomBytes(32));
    const nonce = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const url = new URL(GOOGLE.authUrl);
    url.search = new URLSearchParams({
        client_id: GOOGLE.clientId,
        redirect_uri: GOOGLE.redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
    }).toString();
    return { url: url.toString(), flowCookie: signStep({ kind: "flow", state, nonce, verifier, remember }, FLOW_MINUTES) };
};

// The ID token's claims. Decoding is enough here: it came straight from Google's
// token endpoint over HTTPS in answer to our own request (see the top).
const readIdToken = (idToken) => {
    const parts = typeof idToken === "string" ? idToken.split(".") : [];
    if (parts.length !== 3) throw new AppError("Google sent an unexpected answer", 502);
    try {
        return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
        throw new AppError("Google sent an unexpected answer", 502);
    }
};

// Step 2: the callback. Checks it belongs to the login we started, swaps the
// code for the person's Google profile. Throws a 400 for anything off.
export const finishGoogleLogin = async ({ code, state, flowCookie }) => {
    if (!GOOGLE) throw new AppError("Sign in with Google is not available", 404);
    const flow = verifyStep(flowCookie, "flow");
    if (!flow || typeof state !== "string" || state !== flow.state || typeof code !== "string" || !code || code.length > 2048) {
        throw new AppError("This Google sign-in has expired or doesn't belong to this browser", 400);
    }

    let response;
    try {
        response = await fetch(GOOGLE.tokenUrl, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE.clientId,
                client_secret: GOOGLE.clientSecret,
                redirect_uri: GOOGLE.redirectUri,
                grant_type: "authorization_code",
                code_verifier: flow.verifier,
            }),
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        throw new AppError("Couldn't reach Google", 502);
    }
    // A bad or reused code is the user's problem to retry; say nothing more.
    if (!response.ok) throw new AppError("Google didn't accept this sign-in", 400);
    const claims = readIdToken((await response.json().catch(() => ({}))).id_token);

    const now = Math.floor(Date.now() / 1000);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!ISSUERS.has(claims.iss) || !audience.includes(GOOGLE.clientId) || typeof claims.exp !== "number" || claims.exp < now - 60 || claims.nonce !== flow.nonce) {
        throw new AppError("Google sent a sign-in that isn't for OpenChat", 400);
    }
    if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string") {
        throw new AppError("Google sent an unexpected answer", 502);
    }
    // Only an address Google itself has checked may stand for the person.
    if (claims.email_verified !== true && claims.email_verified !== "true") {
        throw new AppError("Your Google account's email address isn't verified", 400);
    }
    return { sub: claims.sub, email: claims.email.trim().toLowerCase(), name: typeof claims.name === "string" ? claims.name : "", remember: flow.remember !== false };
};

// "Rahul.Kumar+news@gmail.com" → "rahul.kumar"; made to fit the username rules.
const baseUsername = (email) => {
    let base = email.split("@")[0].split("+")[0].toLowerCase().replace(/[^a-z0-9._]/g, "").replace(/\.{2,}/g, ".");
    base = base.replace(/^[^a-z0-9]+/, "").slice(0, 26).replace(/\.+$/, "");
    return base.length >= 3 ? base : `${base}user`.slice(0, 26);
};

// A free username close to the email's: "rahul.kumar", else "rahul.kumar2"...
const suggestUsername = async (email) => {
    const base = baseUsername(email);
    for (let n = 1; n < 1000; n++) {
        const candidate = n === 1 ? base : `${base}${n}`;
        if (isAllowedUsername(candidate) && !(await User.exists({ username: candidate }))) return candidate;
    }
    return `user${randomBytes(4).toString("hex")}`;
};

// Step 3: what the Google account means here.
// - "login": it is already connected to an account.
// - "link": an account with this email exists (password): connect it only
//   after that password is entered (whoever controls the email at Google
//   isn't necessarily the owner of the OpenChat account).
// - "signup": nobody has this email: create an account (next page).
export const resolveGoogleAccount = async (profile) => {
    const connected = await User.findOne({ googleId: profile.sub });
    if (connected) return { kind: "login", user: connected };
    const sameEmail = await User.findOne({ email: profile.email }).select("+googleId");
    if (sameEmail) {
        // The email's account is connected to a different Google account.
        if (sameEmail.googleId) throw new AppError("This email's OpenChat account is connected to another Google account", 409);
        return { kind: "link", pendingCookie: signStep({ kind: "link", sub: profile.sub, email: profile.email }, PENDING_MINUTES) };
    }
    return { kind: "signup", pendingCookie: signStep({ kind: "signup", sub: profile.sub, email: profile.email, name: profile.name }, PENDING_MINUTES) };
};

const readPending = (cookie) => verifyStep(cookie, "signup") ?? verifyStep(cookie, "link");

// The sign-up page's details: the Google email, name and a free username.
export const pendingDetails = async (cookie) => {
    const pending = readPending(cookie);
    if (!pending) throw new AppError("Start again with “Continue with Google”", 401);
    if (pending.kind === "link") return { kind: "link", email: pending.email };
    return { kind: "signup", email: pending.email, name: pending.name, suggestedUsername: await suggestUsername(pending.email) };
};

// Step 4a: create the account. The keys were made in the browser, the
// private key locked with the encryption password the person just chose.
export const completeGoogleSignup = async (cookie, body) => {
    const pending = verifyStep(cookie, "signup");
    if (!pending) throw new AppError("Start again with “Continue with Google”", 401);
    const { username, name, state, publicKey, encryptedPrivateKey } = body ?? {};
    if (name !== undefined && typeof name !== "string") throw new AppError("Name must be text", 400);
    // Someone may have taken the email or the Google account since.
    if (await User.exists({ $or: [{ email: pending.email }, { googleId: pending.sub }] })) {
        throw new AppError("This Google account already has an OpenChat account. Log in instead.", 409);
    }
    return User.create({
        googleId: pending.sub,
        email: pending.email,
        name: name === undefined || name === "" ? pending.name || username : name,
        username,
        state,
        publicKey,
        encryptedPrivateKey,
    });
};

// Step 4b: after a password login, connect the Google account from a "link"
// cookie, if it is for this account's email and the account has none yet.
export const linkGoogleAfterLogin = async (user, cookie) => {
    const pending = verifyStep(cookie, "link");
    if (!pending || pending.email !== user.email) return false;
    const result = await User.updateOne({ _id: user._id, googleId: { $exists: false } }, { $set: { googleId: pending.sub } });
    return result.modifiedCount === 1;
};
