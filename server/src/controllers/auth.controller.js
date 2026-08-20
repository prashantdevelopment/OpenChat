import { loginUser } from "../services/auth.service.js";
import { getUserById } from "../services/user.service.js";


const loginUserController = async (req, res) => {
    const { identifier, password } = req.body;
    const { user, token } = await loginUser(identifier, password);

    const { password: userPassword, ...userWithoutPassword } = user.toObject();

    res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 3600000 // 1 hour
    });

    res.status(200).json({
        success: true, 
        user: userWithoutPassword
    });
}


const getCurrentUserController = async (req, res) => {
    const user = await getUserById(req.user.userId);
    res.status(200).json({
        success: true,
        user
    });
}


const logoutUserController = (req, res) => {
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