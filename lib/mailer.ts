// Outbound email for sign-in codes. Configured with SMTP_* env vars; without
// them nothing is sent — in development the message is logged instead so the
// flow can be exercised, in production sending reports failure.
import nodemailer from "nodemailer";

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!mailConfigured()) {
    if (process.env.NODE_ENV === "production") return false;
    console.log(`[mail → ${to}] ${subject}\n${text}`);
    return true;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
    });
    await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
    return true;
  } catch (e) {
    console.error("[mail] send failed:", (e as Error).message);
    return false;
  }
}
