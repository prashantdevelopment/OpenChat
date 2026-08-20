

const validatePassword = (req, res, next) => {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ message: "Password is required" });
    }

    if (password.length < 8 || password.length > 16) {
        return res.status(400).json({ message: "Password must be between 8 and 16 characters long" });
    }
    if (!/^[a-zA-Z0-9@._-]+$/.test(password)) {
    return res.status(400).json({
        message: "Password can only contain letters, numbers, and @, -, _, ." });
    }
    if (!/[A-Z]/.test(password)) {
        return res.status(400).json({
            message: "Password must contain at least one uppercase letter"
        });
    }
    if (!/[a-z]/.test(password)) {
        return res.status(400).json({
            message: "Password must contain at least one lowercase letter"
        });
    }
    if (!/[0-9]/.test(password)) {
        return res.status(400).json({
            message: "Password must contain at least one number"
        });
    }
    if (!/[@._-]/.test(password)) {
        return res.status(400).json({
            message: "Password must contain at least one special character (@, -, _, .)"
        });
    }
    next();
};

const validateNewPassword = (req, res, next) => {
    const { newPassword } = req.body;
    if (!newPassword) {
        return res.status(400).json({ message: "New password is required" });
    }

    if (newPassword.length < 8 || newPassword.length > 16) {
        return res.status(400).json({ message: "New password must be between 8 and 16 characters long" });
    }
    if (!/^[a-zA-Z0-9@._-]+$/.test(newPassword)) {
    return res.status(400).json({
        message: "New password can only contain letters, numbers, and @, -, _, ." });
    }
    if (!/[A-Z]/.test(newPassword)) {
        return res.status(400).json({
            message: "New password must contain at least one uppercase letter"
        });
    }
    if (!/[a-z]/.test(newPassword)) {
        return res.status(400).json({
            message: "New password must contain at least one lowercase letter"
        });
    }
    if (!/[0-9]/.test(newPassword)) {
        return res.status(400).json({
            message: "New password must contain at least one number"
        });
    }
    if (!/[@._-]/.test(newPassword)) {
        return res.status(400).json({
            message: "New password must contain at least one special character (@, -, _, .)"
        });
    }
    next();

}


export { validatePassword, validateNewPassword };