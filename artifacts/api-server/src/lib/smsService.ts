import { logger } from "./logger";
import twilio from "twilio";

const accountSid = process.env["TWILIO_ACCOUNT_SID"];
const authToken = process.env["TWILIO_AUTH_TOKEN"];
const fromNumber = process.env["TWILIO_PHONE_NUMBER"];

function getClient(): twilio.Twilio | null {
  if (!accountSid || !authToken || !fromNumber) {
    return null;
  }
  return twilio(accountSid, authToken);
}

export function isSmsConfigured(): boolean {
  return !!(accountSid && authToken && fromNumber);
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!isSmsConfigured()) {
    logger.warn("SMS not sent: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER is not configured");
    return false;
  }

  // Normalise the phone number — require E.164 format
  const normalised = to.startsWith("+") ? to : `+${to.replace(/\D/g, "")}`;
  if (normalised.length < 8) {
    logger.warn({ to }, "SMS skipped: phone number too short or malformed");
    return false;
  }

  try {
    const client = getClient()!;
    const message = await client.messages.create({
      body,
      from: fromNumber!,
      to: normalised,
    });
    logger.info({ sid: message.sid, to: normalised }, "SMS sent");
    return true;
  } catch (err) {
    logger.error({ err, to: normalised }, "Failed to send SMS");
    return false;
  }
}

export async function sendSmsToMany(phones: string[], body: string): Promise<void> {
  if (!isSmsConfigured() || phones.length === 0) return;
  await Promise.allSettled(phones.map((p) => sendSms(p, body)));
}
