import nodemailer from "nodemailer";
import { logger } from "../logger.js";

// If SMTP_HOST is set (a real deployment), mail actually sends. If not
// (local dev, the default), the message is just logged — keeps
// registration/password-reset flows fully testable with zero mail
// config, and becomes real the moment an admin sets the env vars.
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

export async function sendEmail(to: string, subject: string, text: string) {
  if (!transporter) {
    logger.info({ to, subject, text }, "SMTP not configured — logging email instead of sending");
    return;
  }
  await transporter.sendMail({ from: process.env.SMTP_FROM ?? "no-reply@localhost", to, subject, text });
}
