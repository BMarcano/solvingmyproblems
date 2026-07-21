// /api/daily-card.js — the subscriber morning ritual.
//
// POST { day, birthdate? } where day is the client's local YYYY-MM-DD. Requires
// an ACTIVE subscription (403 otherwise). One card per subscriber per day: the
// first pull generates and caches it in daily_cards; every later pull that day
// returns the cached card, so a subscriber costs at most one Claude call a day.

import { createClient } from "@supabase/supabase-js";

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

function subscriptionIsActive(sub) {
  if (!sub) return false;
  if (sub.status !== "active" && sub.status !== "trialing") return false;
  if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) {
    return false;
  }
  return true;
}

// The daily pull prompt — kept verbatim from the approved mockup's
// pullDailyCard; `today` is derived from the client's local date so the card
// matches the subscriber's morning, not the server's timezone.
async function generateCard(day, birthdate) {
  const today = new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const prompt = `One-card daily tarot pull for ${today}, for a person born ${birthdate || "(birthdate unknown)"}. Pick ONE of the 78 tarot cards (upright or reversed). Warm, a little witty, never doom-y, one concrete nudge for the day. Respond ONLY with JSON, no fences: { "card": "The Hermit", "message": "2-3 sentences reading the card for today", "nudge": "one specific tiny action for today" }`;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`anthropic ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  const text = (data.content || []).map((b) => b.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!process.env.ANTHROPIC_API_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("daily-card: missing env vars");
    return res.status(500).json({ error: "server_misconfigured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  const day = typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day)
    ? body.day
    : new Date().toISOString().slice(0, 10);
  const birthdate = typeof body.birthdate === "string" ? body.birthdate.slice(0, 10) : "";

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "unauthorized" });

  const { data: userData, error: userError } = await admin().auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: "unauthorized" });
  const userId = userData.user.id;

  // The Daily Card is the subscriber ritual — no subscription, no card.
  const { data: sub, error: subError } = await admin()
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("profile_id", userId)
    .maybeSingle();
  if (subError) {
    console.error("daily-card: subscription lookup failed —", subError.message);
    return res.status(500).json({ error: "gate_failed" });
  }
  if (!subscriptionIsActive(sub)) {
    return res.status(403).json({ error: "subscription_required" });
  }

  // Cached already? One call per subscriber per day.
  const { data: cached } = await admin()
    .from("daily_cards")
    .select("card")
    .eq("profile_id", userId)
    .eq("day", day)
    .maybeSingle();
  if (cached?.card) return res.status(200).json(cached.card);

  let card;
  try {
    card = await generateCard(day, birthdate);
  } catch (first) {
    console.warn("daily-card: first attempt failed, retrying —", first.message);
    try {
      card = await generateCard(day, birthdate);
    } catch (second) {
      console.error("daily-card: failed after retry —", second.message);
      return res.status(502).json({ error: "card_failed" });
    }
  }

  // ignoreDuplicates: if two pulls raced, the first write wins and stays.
  const { error: storeError } = await admin()
    .from("daily_cards")
    .upsert({ profile_id: userId, day, card }, { onConflict: "profile_id,day", ignoreDuplicates: true });
  if (storeError) console.error("daily-card: caching failed —", storeError.message);

  return res.status(200).json(card);
}
