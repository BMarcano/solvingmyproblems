// /api/consult.js — the reading engine for Solving My Problems.
//
// Runs server-side so the Anthropic API key never reaches the browser and so
// that every reading-consumption decision happens here. Client-side gating
// would mean free unlimited readings for anyone with devtools.
//
// GATING_ENABLED off  -> allow every reading (the T1 demo: no login required).
// GATING_ENABLED on   -> verify the Supabase JWT and gate, in order:
//                        active subscription -> allow
//                        else spend_credit()    -> allow
//                        else use_free_reading() -> allow
//                        else 402 payment_required (client opens the paywall).

import { createClient } from "@supabase/supabase-js";

const GATING_ENABLED = process.env.GATING_ENABLED === "true";
const PROBLEM_MAX = 600;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let adminClient = null;
// Service-role client. Bypasses RLS, so it must never be built from anything
// the browser sends — only from server-only env vars.
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

// The reading prompt — kept verbatim from the approved mockup's consultTheTools,
// including the compatibility-mode block and every safety guardrail. Do not edit
// this copy (never predict death/illness/disaster/legal/financial; frame as
// reflection; end useful).
function buildPrompt({ problem, birthdate, birthtime, birthplace, partnerName, partnerBirthdate }) {
  return `You are the reading engine for "Solving My Problems" — a tasteful, fun divination app. A person brings a real problem; five classic tools each offer a lens. Be warm, a little witty, never doom-y. Every reading must end up genuinely useful — the mysticism is the doorway, practical clarity is the destination. Never predict death, illness, disaster, or legal/financial outcomes. Frame everything as reflection.

The person's problem: "${problem}"
Birthdate: ${birthdate || "not given"}
Birth time: ${birthtime || "not given"}
Birthplace: ${birthplace || "not given"}
${partnerBirthdate ? `COMPATIBILITY MODE: this reading is about the connection between the person and ${partnerName || "someone else"} (their birthdate: ${partnerBirthdate}). Read the DYNAMIC between the two people as it bears on this problem — the tarot card describes the relationship, numerology compares both life paths, astrology is a synastry note between the two charts.` : ""}

Derive the numerology life path from the birthdate if given (in compatibility mode, derive and compare BOTH life paths). Pick ONE tarot card (any of the 78, upright or reversed) that fits the problem. Cast ONE I Ching hexagram (give its number 1-64, name, and unicode hexagram symbol from ䷀-䷿). Give one astrology note (sun sign from birthdate if available, otherwise a general transit-flavored note). The 8-ball gives one of its classic 20 answers. Then synthesize.

Respond ONLY with valid JSON, no markdown fences:
{
  "tarot": { "card": "The Star (reversed)", "meaning": "1-2 sentences on the card in context of THIS problem", "advice": "one concrete sentence" },
  "iching": { "number": 24, "name": "Return", "symbol": "䷗", "reading": "1-2 sentences applying it to this problem" },
  "numerology": { "lifePath": "7", "insight": "1-2 sentences connecting the number to how this person tends to approach problems" },
  "astrology": { "sign": "Libra", "note": "1-2 sentences, playful but relevant" },
  "eightball": "Signs point to yes",
  "synthesis": { "headline": "a short poetic-but-clear title for the path forward", "steps": ["three", "practical", "steps — each one specific to the problem, doable this week"] }
}`;
}

// One Anthropic call + parse. Uses the exact request from the mockup (model
// claude-sonnet-4-6, max_tokens 1000, raw HTTP with x-api-key +
// anthropic-version). Throws on a non-2xx response or unparseable JSON.
async function generateReading(prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`anthropic ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  const text = (data.content || []).map((b) => b.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// Returns { userId, spentCredit } when the reading is allowed, or null after it
// has already responded (402/401/500).
async function runGate(req, res) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("consult: GATING_ENABLED is on but Supabase env vars are missing");
    res.status(500).json({ error: "server_misconfigured" });
    return null;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }

  const { data: userData, error: userError } = await admin().auth.getUser(token);
  if (userError || !userData?.user) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  const userId = userData.user.id;

  const { data: sub, error: subError } = await admin()
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("profile_id", userId)
    .maybeSingle();
  if (subError) console.warn("consult: subscription lookup failed —", subError.message);

  if (subscriptionIsActive(sub)) return { userId, spentCredit: false };

  const { data: spent, error: spendError } = await admin().rpc("spend_credit", { p_user: userId });
  if (spendError) {
    console.error("consult: spend_credit failed —", spendError.message);
    res.status(500).json({ error: "gate_failed" });
    return null;
  }
  if (spent === true) return { userId, spentCredit: true };

  const { data: usedFree, error: freeError } = await admin().rpc("use_free_reading", { p_user: userId });
  if (freeError) {
    console.error("consult: use_free_reading failed —", freeError.message);
    res.status(500).json({ error: "gate_failed" });
    return null;
  }
  if (usedFree === true) return { userId, spentCredit: false };

  res.status(402).json({ error: "payment_required" });
  return null;
}

// Users never pay for our errors: hand the credit back if generation failed
// after we spent one.
async function refundCredit(userId) {
  const { error } = await admin().rpc("grant_credits", {
    p_user: userId,
    p_delta: 1,
    p_reason: "refund_error",
    p_stripe_ref: null,
  });
  if (error) {
    // Loud: this is money. Needs manual reconciliation if it ever fires.
    console.error(`consult: REFUND FAILED for ${userId} — ${error.message}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("consult: ANTHROPIC_API_KEY is not set");
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

  const problem = typeof body.problem === "string" ? body.problem.trim() : "";
  if (!problem) return res.status(400).json({ error: "problem_required" });
  if (problem.length > PROBLEM_MAX) {
    return res.status(400).json({ error: "problem_too_long" });
  }

  const birthdate = body.birthdate || "";
  const birthtime = body.birthtime || "";
  const birthplace = body.birthplace || "";
  const partnerName = body.partnerName || "";
  const partnerBirthdate = body.partnerBirthdate || "";
  const mode = body.mode === "duo" || partnerBirthdate ? "duo" : "solo";

  let userId = null;
  let spentCredit = false;
  if (GATING_ENABLED) {
    const gate = await runGate(req, res);
    if (!gate) return; // runGate already responded (401/402/500)
    userId = gate.userId;
    spentCredit = gate.spentCredit;
  }

  const prompt = buildPrompt({ problem, birthdate, birthtime, birthplace, partnerName, partnerBirthdate });

  // Generate; on a parse/HTTP failure retry once, then 502.
  let reading;
  try {
    reading = await generateReading(prompt);
  } catch (first) {
    console.warn("consult: first attempt failed, retrying —", first.message);
    try {
      reading = await generateReading(prompt);
    } catch (second) {
      console.error("consult: failed after retry —", second.message);
      if (spentCredit) await refundCredit(userId);
      return res.status(502).json({ error: "reading_failed" });
    }
  }

  // Store the reading (service role). A failure here must not cost the user the
  // reading they just paid for, so log and still return it.
  if (userId) {
    const { error } = await admin()
      .from("readings")
      .insert({
        profile_id: userId,
        problem,
        mode,
        partner_name: partnerName || null,
        partner_birthdate: partnerBirthdate || null,
        birthdate: birthdate || null,
        result: reading,
      });
    if (error) console.error("consult: storing reading failed —", error.message);
  }

  return res.status(200).json(reading);
}
