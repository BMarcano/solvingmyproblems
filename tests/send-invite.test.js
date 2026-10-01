import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/send-invite.js";

function response() {
  const result = { code: null, body: null };
  return {
    result,
    setHeader() {},
    status(code) { result.code = code; return this; },
    json(body) { result.body = body; return this; },
  };
}

test("only a saved admin grant can trigger an invitation, and delivery failures are visible", async () => {
  const originalFetch = globalThis.fetch;
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "RESEND_API_KEY", "EMAIL_SECRET"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_ANON_KEY = "public-key";
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_SECRET = "test-invitation-secret";

  try {
    const request = { method: "POST", headers: { authorization: "Bearer admin-token" }, body: { email: " Guest@Example.com " } };
    let sends = 0;
    globalThis.fetch = async (url) => {
      if (url.includes("admin_comp_list")) return { ok: true, json: async () => [] };
      sends += 1;
      throw new Error("unexpected send");
    };
    const noGrant = response();
    await handler(request, noGrant);
    assert.equal(noGrant.result.code, 403);
    assert.equal(sends, 0);

    globalThis.fetch = async (url, options) => {
      if (url.includes("admin_comp_list")) return { ok: true, json: async () => [{ email: "guest@example.com", created_at: "2026-09-30T00:00:00Z" }] };
      sends += 1;
      assert.equal(url, "https://api.resend.com/emails");
      assert.deepEqual(JSON.parse(options.body).to, ["guest@example.com"]);
      assert.match(JSON.parse(options.body).html, /\?invite=[A-Za-z0-9_-]+/);
      return { ok: true, json: async () => ({ id: "email-123" }) };
    };
    const sent = response();
    await handler(request, sent);
    assert.equal(sent.result.code, 200);
    assert.equal(sent.result.body.id, "email-123");
    assert.equal(sends, 1);

    globalThis.fetch = async (url) => url.includes("admin_comp_list")
      ? { ok: true, json: async () => [{ email: "guest@example.com", created_at: "2026-09-30T00:00:00Z" }] }
      : { ok: false, status: 422, text: async () => "Rejected" };
    const failed = response();
    const originalError = console.error;
    console.error = () => {};
    try { await handler(request, failed); } finally { console.error = originalError; }
    assert.equal(failed.result.code, 502);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("the server key can resend only the requested saved grant without an admin session", async () => {
  const originalFetch = globalThis.fetch;
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "EMAIL_SECRET"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.SUPABASE_URL = "https://test.supabase.co";
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "maintenance-test-key";
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_SECRET = "test-invitation-secret";

  try {
    const request = { method: "POST", headers: { authorization: "Bearer maintenance-test-key" }, body: { email: " Guest+Access@Example.com " } };
    let sends = 0;
    let lookup = [];
    globalThis.fetch = async (url, options) => {
      if (url.startsWith("https://test.supabase.co/")) {
        const query = new URL(url);
        assert.equal(query.pathname, "/rest/v1/comp_access");
        assert.equal(query.searchParams.get("select"), "email,created_at");
        assert.equal(query.searchParams.get("email"), "eq.guest+access@example.com");
        assert.equal(query.searchParams.get("limit"), "1");
        assert.equal(options.headers.apikey, "maintenance-test-key");
        assert.equal(options.headers.Authorization, "Bearer maintenance-test-key");
        assert.equal(options.body, undefined);
        return { ok: true, json: async () => lookup };
      }
      sends += 1;
      assert.equal(url, "https://api.resend.com/emails");
      assert.deepEqual(JSON.parse(options.body).to, ["guest+access@example.com"]);
      return { ok: true, json: async () => ({ id: "maintenance-email-123" }) };
    };

    // No grant, or a different recipient, must never reach the mail provider.
    for (const grants of [[], [{ email: "other@example.com", created_at: "2026-09-30T00:00:00Z" }]]) {
      lookup = grants;
      const denied = response();
      await handler(request, denied);
      assert.equal(denied.result.code, 403);
      assert.equal(sends, 0);
    }

    lookup = [{ email: "guest+access@example.com", created_at: "2026-09-30T00:00:00Z" }];
    const sent = response();
    await handler(request, sent);
    assert.equal(sent.result.code, 200);
    assert.equal(sent.result.body.id, "maintenance-email-123");
    assert.equal(sends, 1);

    // A different token cannot take the privileged direct-query branch.
    process.env.SUPABASE_ANON_KEY = "public-key";
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://test.supabase.co/rest/v1/rpc/admin_comp_list");
      assert.equal(options.headers.apikey, "public-key");
      assert.equal(options.headers.Authorization, "Bearer wrong-maintenance-key");
      return { ok: true, json: async () => [] };
    };
    const wrongKey = response();
    await handler({ ...request, headers: { authorization: "Bearer wrong-maintenance-key" } }, wrongKey);
    assert.equal(wrongKey.result.code, 403);
    assert.equal(sends, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
