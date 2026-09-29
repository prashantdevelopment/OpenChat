import { pushEnabled, pushPublicKey, removeSubscription, saveSubscription, sendPush } from "../services/push.service.js";

// GET /api/push/config: is it set up, and the key the browser subscribes with.
const configController = (req, res) => {
    res.status(200).json({ success: true, enabled: pushEnabled(), publicKey: pushPublicKey() });
};

// POST /api/push/subscriptions: this browser, for this login session.
const subscribeController = async (req, res) => {
    await saveSubscription(req.user.userId, req.user.sessionId, req.body);
    res.status(201).json({ success: true });
};

// DELETE /api/push/subscriptions: { endpoint } of this browser.
const unsubscribeController = async (req, res) => {
    await removeSubscription(req.user.userId, req.body?.endpoint);
    res.status(200).json({ success: true });
};

// POST /api/push/test: "Notifications are on" to the user's own devices.
const testController = async (req, res) => {
    const sent = await sendPush(req.user.userId, { title: "OpenChat", body: "Notifications are on for this device.", url: "/settings", tag: "test" });
    res.status(200).json({ success: true, sent });
};

export { configController, subscribeController, unsubscribeController, testController };
