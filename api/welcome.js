// /api/welcome.js — one warm welcome email, sent via Resend when an anonymous
// account converts to a real one (email attached at the paywall or afterwards).
//
// Deliberately NOT Supabase's "Confirm email" flow: that inserts an inbox
// round-trip right when someone has their card out. This sends after the
// conversion succeeded, so it costs the funnel nothing. Idempotent via
// user_metadata.smp_welcomed — calling it twice never emails twice.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FROM = "Solving My Problems <hello@solvingmyproblems.com>";

let adminClient = null;
function admin() {
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

function welcomeHtml() {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#12132B;padding:40px 16px;">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background-color:#1C1E3F;border:1px solid #2E3060;border-radius:16px;">
      <tr><td style="padding:40px 36px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
        <img src="https://www.solvingmyproblems.com/brand-mark.png" width="72" height="72" alt="Solving My Problems" style="display:block;margin:0 auto 20px;border-radius:16px;" />
        <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;color:#F4EFE4;">Welcome to the parlor</h1>
        <p style="margin:0 0 26px;font-size:14px;line-height:1.7;color:#C9C7E3;">Your account is set. From here on, your readings, your credits, and &mdash; if you go unlimited &mdash; your daily card all live safely under this address. Sign in from any device and the tools will remember you.</p>
        <table cellpadding="0" cellspacing="0" border="0" align="center"><tr>
          <td style="background-color:#E8C468;border-radius:10px;">
            <a href="https://www.solvingmyproblems.com" style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#12132B;text-decoration:none;">Ask the tools something</a>
          </td>
        </tr></table>
        <p style="margin:26px 0 0;font-size:11px;line-height:1.6;color:#8E8FB8;">For reflection and entertainment &mdash; the practical steps, though, are real.</p>
      </td></tr>
    </table>
    <p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.6;color:#5B5C86;text-align:center;">solvingmyproblems.com &middot; readings are for reflection &amp; entertainment, not professional advice.</p>
  </td></tr>
</table>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("welcome: missing Supabase env vars");
    return res.status(500).json({ error: "server_misconfigured" });
  }

  // No key configured -> quietly do nothing; the welcome email is a nicety and
  // must never break the signup flow.
  if (!process.env.RESEND_API_KEY) {
    console.warn("welcome: RESEND_API_KEY not set — skipping welcome email");
    return res.status(200).json({ sent: false });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "unauthorized" });

  const { data: userData, error: userError } = await admin().auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: "unauthorized" });
  const user = userData.user;

  if (user.is_anonymous || !user.email) {
    return res.status(400).json({ error: "no_email_on_account" });
  }
  if (user.user_metadata?.smp_welcomed) {
    return res.status(200).json({ sent: false });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM,
      to: [user.email],
      subject: "Welcome in · Solving My Problems",
      html: welcomeHtml(),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`welcome: resend ${response.status} — ${detail.slice(0, 300)}`);
    return res.status(502).json({ error: "send_failed" });
  }

  const { error: markError } = await admin().auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, smp_welcomed: true },
  });
  if (markError) console.error("welcome: could not mark smp_welcomed —", markError.message);

  return res.status(200).json({ sent: true });
}
