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

// Public accessor used by admin metrics endpoint to query message status.
export function getTwilioClient(): twilio.Twilio | null {
  return getClient();
}

export function getTwilioFromNumber(): string | undefined {
  return fromNumber;
}

export function isSmsConfigured(): boolean {
  return !!(accountSid && authToken && fromNumber);
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!isSmsConfigured()) {
    logger.warn("SMS not sent: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER is not configured");
    return false;
  }

  // Normalise to E.164. We assume US (+1) when no country code is given —
  // 10 digits → prepend +1; 11 digits starting with 1 → prepend +;
  // already-prefixed (+...) is passed through.
  const digits = to.replace(/\D/g, "");
  let normalised: string;
  if (to.trim().startsWith("+")) {
    normalised = `+${digits}`;
  } else if (digits.length === 10) {
    normalised = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    normalised = `+${digits}`;
  } else {
    normalised = `+${digits}`;
  }
  if (digits.length < 8) {
    logger.warn({ to }, "SMS skipped: phone number too short or malformed");
    return false;
  }

  // A2P 10DLC compliance: every outgoing message must include opt-out language.
  // Append "Reply STOP to opt out." unless it's already present (idempotent).
  const compliantBody = /reply\s+stop/i.test(body)
    ? body
    : `${body.replace(/\s+$/, "")} Reply STOP to opt out.`;

  try {
    const client = getClient()!;
    const message = await client.messages.create({
      body: compliantBody,
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
