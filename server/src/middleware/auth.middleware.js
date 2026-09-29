import AppError from "../utils/AppError.js";
import { setSessionCookie, verifySession } from "../session.js";

// The logged-in user, from the session cookie: req.user = { userId, sessionId }.
// When the session was just renewed (at most daily), the cookie is sent again
// so the browser keeps it as long as the server does.
const authMiddleware = async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        throw new AppError("Authentication token is missing", 401);
    }
    const session = await verifySession(token);
    if (session.renewed && session.remember) setSessionCookie(res, session);
    req.user = { userId: session.userId, sessionId: session.sessionId };
    next();
};

export default authMiddleware;
