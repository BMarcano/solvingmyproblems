import test from "node:test";
import assert from "node:assert/strict";
import { getFullAccess } from "../api/_access.js";

function client({ subscription = null, grant = null, grantError = null }) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = { table, filter: null };
      queries.push(query);
      return {
        select() { return this; },
        eq(column, value) { query.filter = { column, value }; return this; },
        async maybeSingle() {
          if (table === "subscriptions") return { data: subscription, error: null };
          return { data: grant, error: grantError };
        },
      };
    },
  };
}

test("an invited email unlocks each anonymous session, even without a subscription row", async () => {
  const db = client({ grant: { email: "guest@example.com" } });
  const access = await getFullAccess(db, {
    userId: "new-anonymous-id",
    user: { is_anonymous: true, email: null },
    profileEmail: " Guest@Example.com ",
  });
  assert.deepEqual(access, { subscribed: true, comped: true });
  assert.deepEqual(db.queries[1].filter, { column: "email", value: "guest@example.com" });
});

test("a revoked grant blocks an old non-Stripe comp row", async () => {
  const db = client({ subscription: { status: "active", stripe_subscription_id: null, current_period_end: null } });
  const access = await getFullAccess(db, {
    userId: "old-anonymous-id",
    user: { is_anonymous: true },
    profileEmail: "guest@example.com",
  });
  assert.deepEqual(access, { subscribed: false, comped: false });
});

test("a live paid subscription works without a grant lookup", async () => {
  const db = client({ subscription: { status: "active", stripe_subscription_id: "sub_123", current_period_end: null }, grantError: { message: "unavailable" } });
  const access = await getFullAccess(db, {
    userId: "payer-id",
    user: { is_anonymous: false, email: "payer@example.com" },
    profileEmail: "old@example.com",
  });
  assert.deepEqual(access, { subscribed: true, comped: false });
  assert.equal(db.queries.length, 1);
});

test("a registered account uses its auth email, not a stale captured address", async () => {
  const db = client({ grant: { email: "verified@example.com" } });
  await getFullAccess(db, {
    userId: "registered-id",
    user: { is_anonymous: false, email: "Verified@Example.com" },
    profileEmail: "old@example.com",
  });
  assert.equal(db.queries[1].filter.value, "verified@example.com");
});

test("a grant lookup outage raises an error instead of returning locked", async () => {
  const db = client({ grantError: { message: "timeout" } });
  await assert.rejects(
    getFullAccess(db, { userId: "guest-id", user: { is_anonymous: true }, profileEmail: "guest@example.com" }),
    /complimentary access lookup failed: timeout/,
  );
});
