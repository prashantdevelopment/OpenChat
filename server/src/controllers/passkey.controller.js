import { addPasskey, listPasskeys, removePasskey } from "../services/passkey.service.js";
import { describeDevice } from "../session.js";

const listPasskeysController = async (req, res) => {
    res.status(200).json({ success: true, passkeys: await listPasskeys(req.user.userId) });
};

const addPasskeyController = async (req, res) => {
    res.status(201).json({ success: true, passkey: await addPasskey(req.user.userId, req.body, describeDevice(req.get("user-agent"))) });
};

const removePasskeyController = async (req, res) => {
    await removePasskey(req.user.userId, req.params.passkeyId);
    res.status(200).json({ success: true });
};

export { listPasskeysController, addPasskeyController, removePasskeyController };
