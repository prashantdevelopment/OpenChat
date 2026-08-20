import AppError from "../utils/AppError.js";

const errorMiddleware = (err, req, res, next) => {
    console.error(err.stack);
    if( err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        return res.status(409).json({ 
            success: false,
            message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists` });
    }


    if(err.name === "ValidationError") {
        return res.status(400).json({ 
            success: false,
            message: "Validation failed",
            errors: {
                username: err.errors.username ? err.errors.username.message : undefined,
                email: err.errors.email ? err.errors.email.message : undefined,
                password: err.errors.password ? err.errors.password.message : undefined
            }
         });
    }

    if(err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message
        });
    }

    if(err.name === "JsonWebTokenError") {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });
    }

    if(err.name === "TokenExpiredError") {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });
    }

    res.status(500).json({
        success: false,
        message: "Internal Server Error" });
}
export default errorMiddleware;