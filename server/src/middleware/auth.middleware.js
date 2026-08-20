import JWT from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";
import AppError from "../utils/AppError.js";



const authMiddleware = (req, res, next) => {
   const token = req.cookies.token;
    if (!token) {
        throw new AppError("Authentication token is missing", 401);
    }
    
    const decoded = JWT.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
}   


export default authMiddleware;