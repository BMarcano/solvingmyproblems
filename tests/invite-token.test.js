import test from "node:test";
import assert from "node:assert/strict";
import { createInvitationToken, readInvitationToken } from "../api/_invite-token.js";

const priorSecret = process.env.EMAIL_SECRET;
process.env.EMAIL_SECRET = "test-invitation-secret";

test("private invitation token carries the email and grant version without exposing them", () => {
  const created = "2026-09-30T00:00:00.000Z";
  const token = createInvitationToken(" Guest@Example.com ", created);
  assert.doesNotMatch(token, /guest|example/i);
  assert.deepEqual(readInvitationToken(token), { email: "guest@example.com", created });
});

test("tampered and expired invitation tokens are rejected", () => {
  const token = createInvitationToken("guest@example.com", "2026-09-30T00:00:00Z");
  const changed = token[20] === "A" ? "B" : "A";
  assert.throws(() => readInvitationToken(`${token.slice(0, 20)}${changed}${token.slice(21)}`));
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 31 * 24 * 60 * 60 * 1000;
    assert.throws(() => readInvitationToken(token), /Expired or invalid/);
  } finally {
    Date.now = originalNow;
  }
});

test.after(() => {
  if (priorSecret === undefined) delete process.env.EMAIL_SECRET;
  else process.env.EMAIL_SECRET = priorSecret;
});
