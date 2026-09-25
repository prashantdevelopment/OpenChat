import AppError from "../utils/AppError.js";

const errorMiddleware = (err, req, res, next) => {
    if( err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        return res.status(409).json({
            success: false,
            message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists` });
    }


    if(err.name === "ValidationError") {
        const errors = {};
        for (const [field, fieldError] of Object.entries(err.errors)) {
            errors[field] = fieldError.message;
        }
        return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors
         });
    }

    // Mongoose could not convert a value to the schema type (e.g. "abc" as an ObjectId).
    if(err.name === "CastError") {
        return res.status(400).json({
            success: false,
            message: `Invalid ${err.path}`
        });
    }

    // express.json() could not parse the request body.
    if(err.type === "entity.parse.failed") {
        return res.status(400).json({
            success: false,
            message: "Request body is not valid JSON"
        });
    }

    if(err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message
        });
    }

    if(err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });
    }

    // Only unexpected errors are logged; the client never sees the details.
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: "Internal Server Error" });
}
export default errorMiddleware;
