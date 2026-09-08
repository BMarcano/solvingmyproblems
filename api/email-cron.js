// /api/email-cron.js — sends the queued follow-up emails that are due.
//
// Invoked by Vercel Cron (schedule in vercel.json). Vercel adds
// `Authorization: Bearer <CRON_SECRET>` to cron requests when that env var is
// set, and this endpoint refuses anything else — so nobody can trigger sends
// by visiting the URL.
//
// Each due job is claimed (pending -> sending) before it goes out, so two
// overlapping runs can never send the same email twice. A free_nudge whose
// profile has bought something in the meantime is skipped, in case the
// webhook's cancel ever lost the race.

import { createClient } from "@supabase/supabase-js";
import { sendLifecycleEmail, emailConfigured } from "./_emails.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH = 100;

let adminClient = null;
function admin() {
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

async function hasPurchased(profileId) {
  const [{ count }, { data: sub }] = await Promise.all([
    admin()
      .from("credit_ledger")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .in("reason", ["purchase_single", "purchase_fivepack"]),
    admin().from("subscriptions").select("status").eq("profile_id", profileId).maybeSingle(),
  ]);
  return (count || 0) > 0 || sub?.status === "active" || sub?.status === "trialing";
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("email-cron: missing Supabase env vars");
    return res.status(500).json({ error: "server_misconfigured" });
  }
  if (!emailConfigured()) {
    console.warn("email-cron: RESEND_API_KEY not set — nothing sent");
    return res.status(200).json({ sent: 0, skipped: 0, failed: 0, note: "resend_not_configured" });
  }

  const { data: due, error } = await admin()
    .from("email_jobs")
    .select("id, profile_id, kind, payload")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .order("send_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    console.error("email-cron: could not load jobs —", error.message);
    return res.status(500).json({ error: "load_failed" });
  }

  const tally = { sent: 0, skipped: 0, failed: 0 };

  for (const job of due || []) {
    // Claim it. If another run got here first, the update matches nothing.
    const { data: claimed } = await admin()
      .from("email_jobs")
      .update({ status: "sending" })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      const { data: profile } = await admin()
        .from("profiles")
        .select("email, email_opt_out")
        .eq("id", job.profile_id)
        .maybeSingle();

      let status = "skipped";
      if (profile?.email && !profile.email_opt_out) {
        const leftTheFreeSequence = job.kind === "free_nudge" && (await hasPurchased(job.profile_id));
        if (!leftTheFreeSequence) {
          status = await sendLifecycleEmail(admin(), {
            profileId: job.profile_id,
            email: profile.email,
            kind: job.kind,
            payload: job.payload || {},
          });
        }
      }
      await admin()
        .from("email_jobs")
        .update({ status, ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}) })
        .eq("id", job.id);
      tally[status] = (tally[status] || 0) + 1;
    } catch (e) {
      console.error(`email-cron: job ${job.id} (${job.kind}) failed —`, e.message);
      await admin()
        .from("email_jobs")
        .update({ status: "failed", error: String(e.message || e).slice(0, 500) })
        .eq("id", job.id);
      tally.failed += 1;
    }
  }

  console.log(`email-cron: ${JSON.stringify(tally)} of ${due?.length || 0} due`);
  return res.status(200).json(tally);
}
