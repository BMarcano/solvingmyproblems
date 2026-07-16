// /api/consult.js — the reading engine for Solving My Problems.
//
// Runs server-side so the Anthropic API key never reaches the browser and every
// reading-consumption decision happens here. For T1 the gate is stubbed to
// "allow" behind GATING_ENABLED, so the free first reading works with no login
// and the app is a live demo on day one. T2 flips the flag on and wires the
// Supabase JWT + credit/subscription gate into the block below.

const GATING_ENABLED = process.env.GATING_ENABLED === "true";
const PROBLEM_MAX = 600;

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

  // --- Gate (T1: stubbed to allow) ------------------------------------------
  // T2 replaces this block: verify the Supabase JWT -> user id, load the
  // subscription, then decide in order — active subscription -> allow; else
  // spend_credit(user) true -> allow; else use_free_reading(user) true -> allow
  // and increment; else respond 402 { error: "payment_required" } so the client
  // opens the paywall. On a generate failure AFTER a credit was spent, refund
  // via a +1 credit_ledger insert so users never pay for errors.
  if (GATING_ENABLED) {
    // The real gate is not wired yet (arrives in T2). Fail closed rather than
    // silently handing out free unlimited readings if the flag is flipped early.
    console.error("consult: GATING_ENABLED is on but the gate is not implemented yet (T2)");
    return res.status(501).json({ error: "gating_not_implemented" });
  }

  const prompt = buildPrompt({
    problem,
    birthdate: body.birthdate,
    birthtime: body.birthtime,
    birthplace: body.birthplace,
    partnerName: body.partnerName,
    partnerBirthdate: body.partnerBirthdate,
  });

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
      return res.status(502).json({ error: "reading_failed" });
    }
  }

  return res.status(200).json(reading);
}
