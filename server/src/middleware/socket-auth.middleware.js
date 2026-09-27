import { parse } from "cookie";
import { verifySessionToken } from "../session.js";

// The session cookie, checked once when the socket connects. socket.js then
// closes the socket when that session ends (expiry or logout).
const socketAuthMiddleware = (socket, next) => {
  const token = parse(socket.handshake.headers.cookie || "").token;
  if (!token) {
    return next(new Error("Authentication token is missing"));
  }
  try {
    const { userId, jti, exp } = verifySessionToken(token);
    socket.userId = userId;
    socket.data.session = { jti, expiresAt: exp * 1000 };
    next();
  } catch {
    next(new Error("Invalid authentication token"));
  }
};

export default socketAuthMiddleware;
