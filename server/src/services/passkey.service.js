import mongoose from "mongoose";
import User from "../models/user.model.js";
import AppError from "../utils/AppError.js";

// "Unlock with fingerprint or face" (step 79). The browser locks the private
// key a second time with a secret from a passkey (WebAuthn PRF + HKDF +
// AES-GCM, client/src/crypto/passkeys.js) and stores that copy here, next to
// the password one. The server only keeps and returns it: it never sees the
// secret, so it can't open the copy. It doesn't check the passkey either:
// the user is logged in already, and the copy is useless without the device.
export const MAX_PASSKEYS = 10;

const fieldsOf = ({ _id, credentialId, salt, data, iv, name, createdAt }) => ({ _id, credentialId, salt, data, iv, name, createdAt });

// My passkey copies, for the unlock screen and Settings.
export const listPasskeys = async (userId) => {
    const user = await User.findById(userId).select("+passkeyKeys");
    if (!user) throw new AppError("User not found", 404);
    return user.passkeyKeys.map(fieldsOf);
};

// device: which device it is ("Edge on Windows", from the request).
export const addPasskey = async (userId, body, device) => {
    const { credentialId, salt, data, iv } = body ?? {};
    const user = await User.findById(userId).select("+passkeyKeys");
    if (!user) throw new AppError("User not found", 404);
    if (user.passkeyKeys.some((key) => key.credentialId === credentialId)) throw new AppError("This passkey is added already", 409);
    if (user.passkeyKeys.length >= MAX_PASSKEYS) throw new AppError(`At most ${MAX_PASSKEYS} devices can unlock with a passkey. Remove one first.`, 409);
    user.passkeyKeys.push({ credentialId, salt, data, iv, name: device });
    // Checked and added in one step: two adds at once can't pass the limit or
    // add the same passkey twice.
    const added = user.passkeyKeys.at(-1);
    await added.validate().catch((error) => {
        throw error instanceof mongoose.Error.ValidationError ? error : new AppError("Invalid passkey", 400);
    });
    const saved = await User.findOneAndUpdate(
        { _id: userId, "passkeyKeys.credentialId": { $ne: credentialId }, [`passkeyKeys.${MAX_PASSKEYS - 1}`]: { $exists: false } },
        { $push: { passkeyKeys: added.toObject() } },
        { new: true }
    ).select("+passkeyKeys");
    if (!saved) throw new AppError("This passkey is added already, or there are too many", 409);
    return fieldsOf(saved.passkeyKeys.find((key) => key.credentialId === credentialId));
};

export const removePasskey = async (userId, passkeyId) => {
    if (!mongoose.isValidObjectId(passkeyId)) throw new AppError("Invalid passkey id", 400);
    const result = await User.updateOne({ _id: userId, "passkeyKeys._id": passkeyId }, { $pull: { passkeyKeys: { _id: passkeyId } } });
    if (result.modifiedCount === 0) throw new AppError("Passkey not found", 404);
};
