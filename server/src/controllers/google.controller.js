import { CLIENT_URL } from "../config/env.js";
import { setSessionCookie, signSessionToken } from "../session.js";
import {
    completeGoogleSignup,
    finishGoogleLogin,
    googleEnabled,
    pendingDetails,
    resolveGoogleAccount,
    startGoogleLogin,
} from "../services/google.service.js";

const secure = process.env.NODE_ENV === "production";
// The login in progress. Lax: it must come along when Google sends the browser
// back (a top-level navigation from another site); only the callback reads it.
const FLOW_COOKIE = "google_flow";
const flowCookieOptions = { httpOnly: true, secure, sameSite: "lax", path: "/api/auth/google", maxAge: 10 * 60 * 1000 };
// Between the callback and finishing sign-up / linking (read by /api/auth/*).
export const PENDING_COOKIE = "google_pending";
export const pendingCookieOptions = { httpOnly: true, secure, sameSite: "strict", path: "/api/auth", maxAge: 15 * 60 * 1000 };

// Where the browser lands in the app after the callback.
const toApp = (res, path) => res.redirect(303, new URL(path, CLIENT_URL).toString());

// GET /api/auth/providers: which sign-in buttons to show.
const providersController = (req, res) => {
    res.status(200).json({ success: true, google: googleEnabled() });
};

// GET /api/auth/google: off to Google.
const startController = (req, res) => {
    const { url, flowCookie } = startGoogleLogin();
    res.cookie(FLOW_COOKIE, flowCookie, flowCookieOptions);
    res.redirect(303, url);
};

// GET /api/auth/google/callback: back from Google. Never shows an error page of
// its own: every outcome is a page of the app (login, chat or the sign-up form).
const callbackController = async (req, res) => {
    const flowCookie = req.cookies[FLOW_COOKIE];
    res.clearCookie(FLOW_COOKIE, { ...flowCookieOptions, maxAge: undefined });
    // The person pressed "Cancel" at Google.
    if (req.query.error) return toApp(res, "/login?google=cancelled");
    try {
        const profile = await finishGoogleLogin({ code: req.query.code, state: req.query.state, flowCookie });
        const outcome = await resolveGoogleAccount(profile);
        if (outcome.kind === "login") {
            setSessionCookie(res, signSessionToken(outcome.user._id));
            return toApp(res, "/chat");
        }
        res.cookie(PENDING_COOKIE, outcome.pendingCookie, pendingCookieOptions);
        return toApp(res, outcome.kind === "link" ? "/login?google=link" : "/register/google");
    } catch (error) {
        // Logged with the reason; the person just gets "try again".
        console.error("Google sign-in failed:", error.message);
        return toApp(res, error.statusCode === 409 ? "/login?google=taken" : "/login?google=error");
    }
};

// GET /api/auth/google/pending: the sign-up form's details.
const pendingController = async (req, res) => {
    res.status(200).json({ success: true, ...(await pendingDetails(req.cookies[PENDING_COOKIE])) });
};

// POST /api/auth/google/complete: create the account and log in.
const completeController = async (req, res) => {
    const user = await completeGoogleSignup(req.cookies[PENDING_COOKIE], req.body);
    res.clearCookie(PENDING_COOKIE, { ...pendingCookieOptions, maxAge: undefined });
    setSessionCookie(res, signSessionToken(user._id));
    const { password: _password, googleId: _googleId, ...safe } = user.toObject();
    res.status(201).json({ success: true, user: { ...safe, hasPassword: false, google: true } });
};

export { providersController, startController, callbackController, pendingController, completeController };
