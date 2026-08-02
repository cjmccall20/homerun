import { createHmac, timingSafeEqual } from "node:crypto";

import { PEOPLE, isPerson, type Who } from "@/lib/people";

/**
 * Household auth: one shared PIN, one signed cookie, one name picker.
 *
 * There are no accounts here on purpose. Two people share a house and a
 * kitchen; what the app needs to know is "is this one of us" (the PIN) and
 * "which of us is holding the phone" (the name), and neither answer is worth
 * a users table.
 *
 * The cookie is `<payload>.<hmac>`. It is httpOnly so page scripts cannot read
 * it, and it is signed so a phone cannot mint one.
 */

export const SESSION_COOKIE = "homerun_session";
export const WHO_COOKIE = "homerun_who";

export { PEOPLE, isPerson };
export type { Who };

/** A year: this is a home LAN app, not a bank. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

function secret(): string {
  const s = process.env.HOMERUN_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "HOMERUN_SECRET is missing or too short. Set it in .env.local."
    );
  }
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function sign(payload: string): string {
  const mac = createHmac("sha256", secret()).update(payload).digest();
  return `${b64url(Buffer.from(payload, "utf8"))}.${b64url(mac)}`;
}

/** Returns the payload if the signature checks out, otherwise null. */
export function unsign(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }

  const given = Buffer.from(token.slice(dot + 1), "base64url");
  let expected: Buffer;
  try {
    expected = createHmac("sha256", secret()).update(payload).digest();
  } catch {
    return null;
  }
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? payload : null;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length is not leaked by timing alone.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function checkPin(pin: string): boolean {
  const expected = process.env.HOMERUN_PIN;
  if (!expected) return false;
  return constantTimeEquals(pin.trim(), expected.trim());
}

export function makeSessionToken(now: number = Date.now()): string {
  return sign(`ok:${now}`);
}

export function isValidSession(token: string | undefined | null): boolean {
  const payload = unsign(token);
  if (!payload || !payload.startsWith("ok:")) return false;
  const issued = Number(payload.slice(3));
  if (!Number.isFinite(issued)) return false;
  return Date.now() - issued < SESSION_MAX_AGE * 1000;
}

export function makeWhoToken(name: string): string {
  return sign(`who:${name}`);
}

export function readWho(token: string | undefined | null): Who | null {
  const payload = unsign(token);
  if (!payload || !payload.startsWith("who:")) return null;
  const name = payload.slice(4);
  return (PEOPLE as readonly string[]).includes(name) ? (name as Who) : null;
}

