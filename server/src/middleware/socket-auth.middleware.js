import { parse } from "cookie";
import { verifySession } from "../session.js";

// The session cookie, checked when the socket connects. socket.js then closes
// the socket when that session ends (logout, expiry).
const socketAuthMiddleware = async (socket, next) => {
  const token = parse(socket.handshake.headers.cookie || "").token;
  if (!token) {
    return next(new Error("Authentication token is missing"));
  }
  try {
    const { userId, sessionId, expiresAt } = await verifySession(token);
    socket.userId = userId;
    socket.data.session = { sessionId, expiresAt };
    next();
  } catch {
    next(new Error("Invalid authentication token"));
  }
};

export default socketAuthMiddleware;
