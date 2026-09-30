import test from "node:test";
import assert from "node:assert/strict";
import { redeemForUser } from "../api/redeem-invite.js";

const invitation = { email: "guest@example.com", created: "2026-09-30T00:00:00.000Z" };

function client(grant) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table };
      calls.push(call);
      return {
        select() { return this; },
        update(values) { call.values = values; return this; },
        eq(column, value) { call.filter = { column, value }; return this; },
        async maybeSingle() {
          return table === "comp_access"
            ? { data: grant, error: null }
            : { data: { id: "anonymous-id" }, error: null };
        },
      };
    },
  };
}

test("invitation activates the current anonymous browser", async () => {
  const db = client({ email: invitation.email, created_at: invitation.created });
  const result = await redeemForUser(db, { id: "anonymous-id", is_anonymous: true }, invitation);
  assert.equal(result, "redeemed");
  assert.deepEqual(db.calls[1].values, { email: invitation.email });
  assert.deepEqual(db.calls[1].filter, { column: "id", value: "anonymous-id" });
});

test("a registered account with another email cannot claim the invitation", async () => {
  const db = client({ email: invitation.email, created_at: invitation.created });
  assert.equal(await redeemForUser(db, { id: "user-id", is_anonymous: false, email: "other@example.com" }, invitation), "wrong_account");
  assert.equal(db.calls.length, 1);
});

test("revoking or recreating a grant invalidates its prior invitation", async () => {
  for (const grant of [null, { email: invitation.email, created_at: "2026-10-01T00:00:00Z" }]) {
    const db = client(grant);
    assert.equal(await redeemForUser(db, { id: "anonymous-id", is_anonymous: true }, invitation), "expired");
    assert.equal(db.calls.length, 1);
  }
});
