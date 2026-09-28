import { loginUser } from "../services/auth.service.js";
import { getCurrentUser } from "../services/user.service.js";
import { linkGoogleAfterLogin } from "../services/google.service.js";
import { endSession, sessionCookieOptions, setSessionCookie } from "../session.js";
import { PENDING_COOKIE, pendingCookieOptions } from "./google.controller.js";

const loginUserController = async (req, res) => {
    const { identifier, password } = req.body;
    const { user, token } = await loginUser(identifier, password);
    setSessionCookie(res, token);

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
const logoutUserController = (req, res) => {
    if (req.cookies.token) endSession(req.cookies.token);
    res.clearCookie("token", sessionCookieOptions);

    res.status(200).json({
        success: true,
        message: "Logged out successfully"
    });
}

export {
    loginUserController,
    getCurrentUserController,
    logoutUserController
}
