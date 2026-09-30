import test from "node:test";
import assert from "node:assert/strict";
import handler from "./send-invite.js";

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
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "RESEND_API_KEY"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_ANON_KEY = "public-key";
  process.env.RESEND_API_KEY = "test-key";

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
      if (url.includes("admin_comp_list")) return { ok: true, json: async () => [{ email: "guest@example.com" }] };
      sends += 1;
      assert.equal(url, "https://api.resend.com/emails");
      assert.deepEqual(JSON.parse(options.body).to, ["guest@example.com"]);
      return { ok: true, json: async () => ({ id: "email-123" }) };
    };
    const sent = response();
    await handler(request, sent);
    assert.equal(sent.result.code, 200);
    assert.equal(sent.result.body.id, "email-123");
    assert.equal(sends, 1);

    globalThis.fetch = async (url) => url.includes("admin_comp_list")
      ? { ok: true, json: async () => [{ email: "guest@example.com" }] }
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
