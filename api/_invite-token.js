import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const INVITE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function key() {
  const secret = process.env.EMAIL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Invitation signing secret is not configured");
  return createHash("sha256").update(secret).digest();
}

export function createInvitationToken(email, createdAt) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) throw new Error("Invalid invitation email");
  const created = new Date(createdAt).toISOString();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const payload = JSON.stringify({ v: 1, email: normalized, created, issued: Date.now() });
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function readInvitationToken(token) {
  if (typeof token !== "string" || token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Invalid invitation token");
  }
  const raw = Buffer.from(token, "base64url");
  if (raw.length < 29) throw new Error("Invalid invitation token");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const payload = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
  const now = Date.now();
  if (payload.v !== 1 || !EMAIL_RE.test(payload.email) ||
      new Date(payload.created).toISOString() !== payload.created ||
      !Number.isFinite(payload.issued) || payload.issued > now + 5 * 60 * 1000 ||
      now - payload.issued > INVITE_LIFETIME_MS) {
    throw new Error("Expired or invalid invitation token");
  }
  return { email: payload.email, created: payload.created };
}
