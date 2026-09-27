import { getIceServers } from "../services/iceServers.service.js";

const getIceServersController = async (req, res) => {
    // Credentials for one call: never cached by the browser or a proxy.
    res.set("Cache-Control", "no-store");
    res.status(200).json({ success: true, iceServers: await getIceServers() });
};

export { getIceServersController };
