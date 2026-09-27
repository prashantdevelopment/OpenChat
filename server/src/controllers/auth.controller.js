import { loginUser } from "../services/auth.service.js";
import { getCurrentUser } from "../services/user.service.js";
import { endSession, SESSION_HOURS } from "../session.js";


const loginUserController = async (req, res) => {
    const { identifier, password } = req.body;
    const { user, token } = await loginUser(identifier, password);

    const { password: userPassword, ...userWithoutPassword } = user.toObject();

    res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: SESSION_HOURS * 60 * 60 * 1000
    });

    res.status(200).json({
        success: true, 
        user: userWithoutPassword
    });
}


const getCurrentUserController = async (req, res) => {
    const user = await getCurrentUser(req.user.userId);
    res.status(200).json({
        success: true,
        user
    });
}


// Ends the session on the server as well (the token stops working and its
// sockets close), then deletes the cookie.
const logoutUserController = (req, res) => {
    if (req.cookies.token) endSession(req.cookies.token);
    res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict"
    });

    res.status(200).json({
        success: true,
        message: "Logged out successfully"
    });
}

export {
    loginUserController,
    getCurrentUserController,
    logoutUserController
}