import AppError from "../utils/AppError.js";

// Returns the first rule the password breaks, or null if it is valid.
// `label` is used in the message ("Password" or "New password").
const getPasswordError = (password, label) => {
    if (typeof password !== "string" || password === "") {
        return `${label} is required`;
    }
    if (password.length < 8 || password.length > 16) {
        return `${label} must be between 8 and 16 characters long`;
    }
    if (!/^[a-zA-Z0-9@._-]+$/.test(password)) {
        return `${label} can only contain letters, numbers, and @, -, _, .`;
    }
    if (!/[A-Z]/.test(password)) {
        return `${label} must contain at least one uppercase letter`;
    }
    if (!/[a-z]/.test(password)) {
        return `${label} must contain at least one lowercase letter`;
    }
    if (!/[0-9]/.test(password)) {
        return `${label} must contain at least one number`;
    }
    if (!/[@._-]/.test(password)) {
        return `${label} must contain at least one special character (@, -, _, .)`;
    }
    return null;
};

const validatePassword = (req, res, next) => {
    const error = getPasswordError(req.body.password, "Password");
    if (error) {
        throw new AppError(error, 400);
    }
    next();
};

const validateNewPassword = (req, res, next) => {
    const error = getPasswordError(req.body.newPassword, "New password");
    if (error) {
        throw new AppError(error, 400);
    }
    next();
};


export { validatePassword, validateNewPassword };
