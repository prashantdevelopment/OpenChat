import { createReport } from "../services/report.service.js";

const createReportController = async (req, res) => {
    const { userId, reason, details, conversationId, alsoBlock } = req.body;
    const { blocked } = await createReport(req.user.userId, { userId, reason, details, conversationId, alsoBlock });
    res.status(201).json({ success: true, message: "Report sent", blocked });
};

export { createReportController };
