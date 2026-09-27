import AppError from "../utils/AppError.js";
import { verifySessionToken } from "../session.js";

// The logged-in user, from the session cookie: req.user = { userId, ... }.
const authMiddleware = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        throw new AppError("Authentication token is missing", 401);
    }
    req.user = verifySessionToken(token);
    next();
};

export default authMiddleware;
