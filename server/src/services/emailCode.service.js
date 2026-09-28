import { createHmac, randomInt, timingSafeEqual } from "crypto";
import EmailCode from "../models/emailCode.model.js";
import User from "../models/user.model.js";
import { CLIENT_URL, JWT_SECRET } from "../config/env.js";
import AppError from "../utils/AppError.js";
import { canSendEmail, sendEmail } from "./email.service.js";

// Email codes at registration: a new account needs a real inbox. Six random
// digits, valid 10 minutes, 5 wrong tries, a new one at most every minute and
// 5 an hour per address. Only a keyed hash is stored (a leaked database alone
// doesn't give the codes). The answer never says whether an address already
// has an account: that address gets a "you already have an account" email
// instead of a code.

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const SENDS_PER_HOUR = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const codeKey = createHmac("sha256", JWT_SECRET).update("openchat/email-code").digest();
const hashCode = (email, code) => createHmac("sha256", codeKey).update(`${email}:${code}`).digest("hex");

// Tests without a mailbox switch this off (EMAIL_VERIFICATION=off; never in production).
export const emailVerificationOn = () => process.env.EMAIL_VERIFICATION !== "off";
export const emailSignupAvailable = () => !emailVerificationOn() || canSendEmail();

const normalize = (email) => {
    if (typeof email !== "string") throw new AppError("Please enter a valid email address", 400, { field: "email" });
    const clean = email.trim().toLowerCase();
    if (clean.length > 254 || !EMAIL_PATTERN.test(clean)) throw new AppError("Please enter a valid email address", 400, { field: "email" });
    return clean;
};

const codeEmail = (code) => ({
    subject: `${code} is your OpenChat code`,
    text: `Your OpenChat sign-up code is ${code}.\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email: nobody can use your address without the code.`,
    html: `<p>Your OpenChat sign-up code is</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px;font-family:monospace">${code}</p><p>It works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email: nobody can use your address without the code.</p>`,
});

const alreadyEmail = () => {
    const login = new URL("/login", CLIENT_URL).toString();
    return {
        subject: "You already have an OpenChat account",
        text: `Someone, maybe you, tried to create an OpenChat account with this email address. You already have one: log in at ${login}\n\nIf it wasn't you, you can ignore this email.`,
        html: `<p>Someone, maybe you, tried to create an OpenChat account with this email address. You already have one: <a href="${login}">log in</a>.</p><p>If it wasn't you, you can ignore this email.</p>`,
    };
};

// Sends a code (or the "already have an account" note). Returns when the next
// one can be asked for.
export const startEmailCode = async (rawEmail) => {
    const email = normalize(rawEmail);
    if (!canSendEmail()) throw new AppError("Sign-up by email isn't available right now. Use Continue with Google.", 503);

    const now = Date.now();
    const previous = await EmailCode.findOne({ email });
    if (previous) {
        const wait = Math.ceil((previous.lastSentAt.getTime() + RESEND_SECONDS * 1000 - now) / 1000);
        if (wait > 0) throw new AppError(`Please wait ${wait} seconds before asking for a new code`, 429);
        const inWindow = now - previous.windowStartedAt.getTime() < 60 * 60 * 1000;
        if (inWindow && previous.sends >= SENDS_PER_HOUR) throw new AppError("Too many codes for this address. Try again in an hour.", 429);
    }

    const hasAccount = await User.exists({ email });
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await sendEmail({ to: email, ...(hasAccount ? alreadyEmail() : codeEmail(code)) });

    const inWindow = previous && now - previous.windowStartedAt.getTime() < 60 * 60 * 1000;
    await EmailCode.updateOne(
        { email },
        {
            $set: {
                // An existing account's address gets a code nobody knows, so both cases look alike.
                codeHash: hashCode(email, hasAccount ? `x${code}` : code),
                expiresAt: new Date(now + CODE_MINUTES * 60 * 1000),
                attempts: 0,
                lastSentAt: new Date(now),
                sends: inWindow ? previous.sends + 1 : 1,
                windowStartedAt: inWindow ? previous.windowStartedAt : new Date(now),
            },
        },
        { upsert: true },
    );
    return { resendAfter: RESEND_SECONDS };
};

// Throws (on the "code" field) unless `code` is the current code for `email`.
// A wrong guess counts; after MAX_ATTEMPTS the code stops working.
export const checkEmailCode = async (rawEmail, code) => {
    if (!emailVerificationOn()) return;
    const email = normalize(rawEmail);
    if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) throw new AppError("Enter the 6-digit code from the email", 400, { field: "code" });
    // Every try is counted first, in one atomic update, so parallel requests
    // can't get more than MAX_ATTEMPTS guesses.
    const record = await EmailCode.findOneAndUpdate(
        { email, expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_ATTEMPTS } },
        { $inc: { attempts: 1 } },
    );
    if (!record) {
        const tooMany = await EmailCode.exists({ email, expiresAt: { $gt: new Date() } });
        throw new AppError(tooMany ? "Too many wrong tries. Ask for a new code." : "This code has expired. Ask for a new one.", 400, { field: "code" });
    }
    const expected = Buffer.from(record.codeHash, "hex");
    const given = Buffer.from(hashCode(email, code.trim()), "hex");
    if (!timingSafeEqual(expected, given)) throw new AppError("That code isn't right", 400, { field: "code" });
};

// After the account was created: the code can't be used again.
export const useUpEmailCode = (email) => EmailCode.deleteOne({ email: String(email).trim().toLowerCase() });
