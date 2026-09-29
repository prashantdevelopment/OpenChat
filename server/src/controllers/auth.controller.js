import { loginUser } from "../services/auth.service.js";
import { getCurrentUser } from "../services/user.service.js";
import { linkGoogleAfterLogin } from "../services/google.service.js";
import { createSession, endOtherSessions, endSession, endSessionOf, listSessions, sessionCookieOptions, setSessionCookie } from "../session.js";
import { PENDING_COOKIE, pendingCookieOptions } from "./google.controller.js";

const loginUserController = async (req, res) => {
    const { identifier, password } = req.body;
    const { user } = await loginUser(identifier, password);
    // "Keep me logged in" is on unless the login form says otherwise.
    setSessionCookie(res, await createSession(user._id, { remember: req.body.remember !== false, userAgent: req.get("user-agent") }));

    // Came from "Continue with Google" with this account's email: the right
    // password connects that Google account (google.service.js).
    let linkedGoogle = false;
    if (req.cookies[PENDING_COOKIE]) {
        linkedGoogle = await linkGoogleAfterLogin(user, req.cookies[PENDING_COOKIE]).catch(() => false);
        res.clearCookie(PENDING_COOKIE, { ...pendingCookieOptions, maxAge: undefined });
    }

    const { password: _hash, googleId, ...userWithoutPassword } = user.toObject();
    res.status(200).json({
        success: true,
        user: { ...userWithoutPassword, hasPassword: true, google: linkedGoogle || Boolean(googleId) },
        linkedGoogle,
    });
}


const getCurrentUserController = async (req, res) => {
    const user = await getCurrentUser(req.user.userId);
    res.status(200).json({
        success: true,
        user
    });
}


// Ends the session on the server as well (the token stops working and its
// sockets close), then deletes the cookie.
const logoutUserController = async (req, res) => {
    await endSession(req.cookies.token);
    res.clearCookie("token", sessionCookieOptions);

    res.status(200).json({
        success: true,
        message: "Logged out successfully"
    });
}

// GET /api/auth/sessions: where the user is logged in (Settings).
const listSessionsController = async (req, res) => {
    res.status(200).json({ success: true, sessions: await listSessions(req.user.userId, req.user.sessionId) });
};

// DELETE /api/auth/sessions/:sessionId: log out one of the user's devices.
const endSessionController = async (req, res) => {
    const found = await endSessionOf(req.user.userId, req.params.sessionId);
    if (!found) return res.status(404).json({ success: false, message: "That session has already ended" });
    // Ending the current one is a logout: the cookie goes too.
    if (req.params.sessionId === req.user.sessionId) res.clearCookie("token", sessionCookieOptions);
    res.status(200).json({ success: true });
};

// POST /api/auth/sessions/end-others: log out every other device.
const endOtherSessionsController = async (req, res) => {
    const ended = await endOtherSessions(req.user.userId, req.user.sessionId);
    res.status(200).json({ success: true, ended });
};

export {
    listSessionsController,
    endSessionController,
    endOtherSessionsController,
    loginUserController,
    getCurrentUserController,
    logoutUserController
}
