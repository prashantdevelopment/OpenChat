import { EMAIL } from "../config/env.js";
import AppError from "../utils/AppError.js";

// Sends one email. Through Brevo's transactional API when it is set up
// (https://developers.brevo.com/reference/sendtransacemail); in development
// without it, printed in the server's console instead. In production without
// it, email isn't available (canSendEmail() is false).
export const canSendEmail = () => Boolean(EMAIL) || process.env.NODE_ENV !== "production";

export const sendEmail = async ({ to, subject, text, html }) => {
    if (!EMAIL) {
        if (process.env.NODE_ENV === "production") throw new AppError("Email isn't set up on this server", 503);
        console.log(`\n[email to ${to}] ${subject}\n${text}\n`);
        return;
    }
    let response;
    try {
        response = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: { "api-key": EMAIL.brevoApiKey, "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ sender: { name: EMAIL.fromName, email: EMAIL.from }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        throw new AppError("Couldn't send the email. Please try again in a moment.", 502);
    }
    if (!response.ok) {
        // Brevo's reason goes to the log (e.g. an unverified sender), never to the person.
        console.error("Brevo refused an email:", response.status, (await response.text().catch(() => "")).slice(0, 300));
        throw new AppError("Couldn't send the email. Please try again in a moment.", 502);
    }
};
