import JWT from "jsonwebtoken";
import { parse } from "cookie";
import { JWT_SECRET } from "../config/env.js";

const socketAuthMiddleware = (socket, next) => {
  try {
    const cookies = parse(socket.handshake.headers.cookie || "");
    const token = cookies.token;
    if (!token) {
      return next(new Error("Authentication token is missing"));
    }

    const decoded = JWT.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    return next(new Error("Invalid authentication token"));
  }
};

export default socketAuthMiddleware;