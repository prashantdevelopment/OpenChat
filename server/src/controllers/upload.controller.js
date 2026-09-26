import { createUpload, readUpload } from "../services/upload.service.js";

const createUploadController = async (req, res) => {
    const upload = await createUpload(req.params.conversationId, req.user.userId, req.body, req.query.kind);
    res.status(201).json({ success: true, ...upload });
};

// Encrypted bytes: the browser decrypts them. Never shown by the browser as a
// page (attachment + nosniff), cached privately (the content never changes).
const readUploadController = async (req, res) => {
    const bytes = await readUpload(req.params.fileId, req.user.userId);
    res.set({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
    });
    res.send(bytes);
};

export { createUploadController, readUploadController };
