import AppError from "../utils/AppError.js";

// Policy follows OWASP ASVS 5.0: length matters, composition rules don't.
// Any characters are allowed (spaces, symbols, emoji) so passphrases and
// password managers work.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 64;
// bcrypt ignores everything after 72 bytes, so longer input would give a
// false sense of security (emoji and some scripts use up to 4 bytes per character).
const MAX_PASSWORD_BYTES = 72;

// Common passwords that pass the length rule. Compared case-insensitively.
const COMMON_PASSWORDS = new Set([
    "password", "password1", "password12", "password123", "password@123", "passw0rd", "p@ssw0rd", "p@ssword",
    "12345678", "123456789", "1234567890", "12341234", "11111111", "00000000", "87654321", "123123123",
    "qwerty123", "qwertyuiop", "1q2w3e4r", "1qaz2wsx", "asdfghjk", "zxcvbnm1", "abcd1234", "abc12345",
    "iloveyou", "iloveyou1", "sunshine", "princess", "football", "baseball", "superman", "starwars",
    "whatever", "welcome1", "welcome123", "letmein1", "trustno1", "admin123", "admin@123", "changeme",
    "india123", "india@123", "bharat123", "cricket123", "krishna123", "openchat", "openchat123"
]);

// Returns the first rule the password breaks, or null if it is valid.
// `label` is used in the message ("Password" or "New password").
const getPasswordError = (password, label) => {
    if (typeof password !== "string" || password === "") {
        return `${label} is required`;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        return `${label} must be at least ${MIN_PASSWORD_LENGTH} characters long`;
    }
    if (password.length > MAX_PASSWORD_LENGTH || Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
        return `${label} is too long (maximum ${MAX_PASSWORD_LENGTH} characters)`;
    }
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
        return `${label} is too common, please choose another one`;
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
