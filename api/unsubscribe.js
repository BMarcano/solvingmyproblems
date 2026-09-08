// /api/unsubscribe.js — the unsubscribe link in every lifecycle email.
//
// GET  ?u=<profile id>&t=<token>  -> opts the profile out and shows a small page
// POST (same query)               -> the RFC 8058 one-click form mail clients send
//
// The token is an HMAC of the profile id (see _emails.js), so a link only ever
// opts out the person it was sent to. Opting out stops the marketing sequences;
// receipts and account emails are unaffected.

import { createClient } from "@supabase/supabase-js";
import { verifyUnsubscribeToken, SITE } from "./_emails.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let adminClient = null;
function admin() {
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title} · Solving My Problems</title></head>
<body style="margin:0;background:#12132B;font-family:Arial,Helvetica,sans-serif;color:#C9C7E3;">
  <div style="max-width:440px;margin:80px auto;padding:36px 32px;background:#1C1E3F;border:1px solid #2E3060;border-radius:18px;text-align:center;">
    <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;color:#F4EFE4;">${title}</h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.7;">${body}</p>
    <a href="${SITE}" style="color:#E8C468;font-weight:bold;text-decoration:none;">solvingmyproblems.com &rarr;</a>
  </div>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).send("Method not allowed");
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).send("Server misconfigured");
  }

  const profileId = typeof req.query?.u === "string" ? req.query.u : "";
  const token = typeof req.query?.t === "string" ? req.query.t : "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!verifyUnsubscribeToken(profileId, token)) {
    return res.status(400).send(page("That link has expired", "Reply to any of our emails and a human will take you off the list."));
  }

  const { error } = await admin().from("profiles").update({ email_opt_out: true }).eq("id", profileId);
  if (error) {
    console.error("unsubscribe: update failed —", error.message);
    return res.status(500).send(page("Something went sideways", "Try the link again in a moment, or reply to the email and we'll do it by hand."));
  }

  return res.status(200).send(page("You're off the list", "No more nudges from the tools. Your readings stay right where they are."));
}
