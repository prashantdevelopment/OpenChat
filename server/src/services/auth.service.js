import User from "../models/user.model.js"
import bcrypt from "bcrypt";
import AppError from "../utils/AppError.js";

const loginUser = async (identifier, password) => {

    // Strings only: an object like { "$ne": null } must never reach the query.
    if (typeof identifier !== "string" || typeof password !== "string" || !identifier.trim() || !password) {
        throw new AppError("Username/email and password are required", 400);
    }

    const normalizedIdentifier = identifier.trim().toLowerCase();

    const findUser = await User.findOne({
        $or: [    
            { username: normalizedIdentifier }, 
            { email: normalizedIdentifier }
        ]
    }).select("+password +encryptedPrivateKey +googleId");

    // No such account, or one made with Google (no password to check): the
    // same answer either way, so the form doesn't reveal which accounts exist.
    if (!findUser || !findUser.password) {
        throw new AppError("Invalid username/email or password", 401);
    }

    const isPasswordValid = await bcrypt.compare(password, findUser.password);
    if (!isPasswordValid) {
        throw new AppError("Invalid username/email or password", 401);
    }


    return { user: findUser };
}  


export {
    loginUser
}   
