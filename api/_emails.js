// /api/_emails.js — the lifecycle emails (copy by Ashley), the Resend sender,
// and the little queue that runs the day-4 follow-ups.
//
// Underscore-prefixed so Vercel treats this as a shared module, not an endpoint.
//
// Two sequences, both two emails long:
//   FREE  (email captured for the free reading)  welcome now · free_nudge +4d
//   PAID  (Stripe checkout completed)            purchase now · paid_checkin +4d
// Paying moves a person from the first to the second: the webhook cancels any
// pending free_nudge before queuing the paid emails.
//
// "Now" emails are sent inline by whoever triggers them; "+4d" emails are rows
// in public.email_jobs that /api/email-cron sends when due. Every email —
// immediate or queued — leaves a row in email_jobs, so the table doubles as the
// send log, and the unique (kind, ref) index makes every send exactly-once.

import { createHmac } from "node:crypto";

export const SITE = "https://www.solvingmyproblems.com";
export const FROM = "Solving My Problems <hello@solvingmyproblems.com>";
export const PROMO_CODE = "Problems-Solved";
export const FOLLOW_UP_DAYS = 4;

const PROMO_LINK = `${SITE}/?promo=${PROMO_CODE}`;
const READING_LINK = `${SITE}/?reading=last`;

// ---------- layout (Midnight Parlor, table-based for email clients) ----------

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const SERIF = "font-family:Georgia,'Times New Roman',serif;";
const P = `style="margin:0 0 16px;${FONT}font-size:15px;line-height:1.7;color:#C9C7E3;"`;
const MUTED = `style="margin:0 0 16px;${FONT}font-size:13px;line-height:1.7;color:#8E8FB8;"`;
const H = `style="margin:0 0 18px;${SERIF}font-size:27px;font-weight:600;line-height:1.25;color:#F4EFE4;"`;
const SUB = `style="margin:0 0 6px;${SERIF}font-size:19px;font-weight:600;line-height:1.3;color:#F4EFE4;"`;

function button(label, href) {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr>
    <td align="center" style="background-color:#E8C468;border-radius:10px;">
      <a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;${FONT}font-size:15px;font-weight:bold;color:#12132B;text-decoration:none;">${label}</a>
    </td>
  </tr></table>`;
}

function codeBox() {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 22px;"><tr>
    <td style="background-color:#12132B;border:1px solid #E8C468;border-radius:10px;padding:14px 22px;">
      <span style="${FONT}font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#8E8FB8;">Code</span><br />
      <span style="font-family:'Courier New',Courier,monospace;font-size:20px;font-weight:bold;color:#E8C468;">${PROMO_CODE}</span>
      <span style="${FONT}font-size:14px;color:#C9C7E3;">&nbsp;&rarr; 15% off, forever</span>
    </td>
  </tr></table>`;
}

function priceList() {
  const row = (name, price, note) => `<tr>
    <td style="padding:6px 0;${FONT}font-size:14px;color:#F4EFE4;white-space:nowrap;">${name}&nbsp;&middot;&nbsp;<span style="color:#E8C468;">${price}</span></td>
    <td style="padding:6px 0 6px 14px;${FONT}font-size:13px;color:#8E8FB8;">${note}</td>
  </tr>`;
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
    ${row("One reading", "$1.99", "for tonight's problem")}
    ${row("Five readings", "$7.97", "because problems rarely travel alone")}
    ${row("Unlimited + the Daily Card", "$4.99/mo", "every problem, plus one card every morning")}
  </table>`;
}

function shell({ preview, inner, unsubscribeUrl }) {
  const unsubscribe = unsubscribeUrl
    ? ` &middot; <a href="${unsubscribeUrl}" style="color:#5B5C86;text-decoration:underline;">unsubscribe</a>`
    : "";
  return `<!doctype html><html><body style="margin:0;background-color:#12132B;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#12132B;padding:40px 16px;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;width:100%;">
        <tr><td align="center" style="padding-bottom:22px;">
          <img src="${SITE}/brand-mark.png" width="56" height="56" alt="" style="display:block;margin:0 auto 12px;border-radius:14px;" />
          <div style="${SERIF}font-size:22px;font-weight:600;color:#F4EFE4;">Solving <em style="color:#E8C468;">My</em> Problems</div>
        </td></tr>
        <tr><td style="background-color:#1C1E3F;border:1px solid #2E3060;border-radius:18px;padding:36px 34px;">${inner}</td></tr>
        <tr><td align="center" style="padding-top:22px;${FONT}font-size:11px;line-height:1.8;color:#5B5C86;">
          <span style="letter-spacing:.2em;text-transform:uppercase;">Five advisors &middot; One problem</span><br />
          <a href="${SITE}" style="color:#5B5C86;text-decoration:none;">solvingmyproblems.com</a>${unsubscribe}<br />
          Readings are for reflection &amp; entertainment, not professional advice.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

// ---------- the four emails ----------

// FREE · EMAIL 1 — welcome, right after the email is captured
export function welcomeEmail({ unsubscribeUrl }) {
  const preview = "15% off forever, because the tools like you already.";
  return {
    subject: "Your reading awaits (plus a little gift)",
    html: shell({
      preview,
      unsubscribeUrl,
      inner: `<p ${H}>Hey</p>
        <p ${P}>Welcome to the strange and wonderful corner of the internet where five ancient advisors gang up on one modern problem. Tarot, the I Ching, numerology, the stars, and one very opinionated 8-ball.</p>
        <p ${P}>Your first reading is on the house. Go get it, sit with it, re-read it in three days when the situation shifts. That's when it usually clicks.</p>
        <p ${P}>And because we like you, here's a housewarming gift:</p>
        ${codeBox()}
        <p ${P}>Not for 48 hours. Not "this weekend only." <strong style="color:#F4EFE4;">Forever.</strong> Every reading, every pack, every month if you go unlimited:</p>
        ${priceList()}
        <p ${P}>With the code, unlimited runs about $4.24/mo. The stars, for less than a latte.</p>
        ${button("Get your free reading &rarr;", PROMO_LINK)}`,
    }),
  };
}

// FREE · EMAIL 2 — day-4 nudge
export function freeNudgeEmail({ unsubscribeUrl }) {
  const preview = "Be honest. There's at least one.";
  return {
    subject: "Have any more problems?",
    html: shell({
      preview,
      unsubscribeUrl,
      inner: `<p ${H}>Hey again</p>
        <p ${P}>Quick question: that thing you got a reading about the other day... solved? Or did it do what problems usually do and invite a friend?</p>
        <p ${P}>Because the tools are still here. Still patient. Still weirdly good at seeing the angle you haven't.</p>
        <p ${P}>And your 15% off forever code is still sitting there unused:</p>
        ${codeBox()}
        <p ${P}>One reading for tonight's spiral, five for the collection, or unlimited with a Daily Card every morning to catch problems before they get big.</p>
        <p ${P}>Sixty seconds. Five perspectives. One less thing circling your brain at 2am.</p>
        ${button("Ask the tools &rarr;", PROMO_LINK)}`,
    }),
  };
}

// Tier-swap lines (Ashley's copy), keyed by the sku bought.
const PURCHASE_TIER_LINE = {
  single: "And when the next problem shows up, you know where the tools live.",
  fivepack: "You've got more readings in the bank, so don't save them for a crisis. Small questions get good answers too.",
  sub: "Your Daily Card starts tomorrow morning. One card, every day, read against your chart. Small ritual, oddly grounding.",
};

const CHECKIN_TIER_LINE = {
  single: `Your 15% forever code still works on everything: <strong style="font-family:'Courier New',Courier,monospace;color:#E8C468;">${PROMO_CODE}</strong>`,
  fivepack: "You've still got readings waiting in your account. They don't expire, but problems appreciate punctuality.",
  sub: "Been keeping up with your Daily Card? Tomorrow morning's card already knows if you haven't.",
};

// PAID · EMAIL 1 — right after the purchase
export function purchaseEmail({ sku, unsubscribeUrl }) {
  const preview = "Your reading is ready. The 8-ball is stretching.";
  return {
    subject: "The tools are in session",
    html: shell({
      preview,
      unsubscribeUrl,
      inner: `<p ${H}>Hey</p>
        <p ${P}>It's official: five ancient advisors just picked up your problem and started arguing about it. Tarot, the I Ching, numerology, the stars, and the 8-ball waiting to break the tie.</p>
        <p ${P}>Your reading is ready for you here:</p>
        ${button("See your reading &rarr;", READING_LINK)}
        <p ${P}>A tip from people who've been doing this a while: read it now, then read it again in a few days. Readings have a funny way of meaning more once the situation moves.</p>
        <p ${P}>${PURCHASE_TIER_LINE[sku] || PURCHASE_TIER_LINE.single}</p>
        <p ${P}>Problems rarely travel alone. Good thing you don't either.</p>`,
    }),
  };
}

// PAID · EMAIL 2 — day-4 check-in
export function paidCheckinEmail({ sku, unsubscribeUrl }) {
  const preview = "Solved, shrunk, or multiplied?";
  const cta = sku === "single" ? PROMO_LINK : SITE;
  return {
    subject: "So... how's the problem doing?",
    html: shell({
      preview,
      unsubscribeUrl,
      inner: `<p ${H}>Hey</p>
        <p ${P}>Checking in on the problem you brought to the tools the other day. Usually one of three things has happened by now:</p>
        <p ${SUB}>It's solved</p>
        <p ${P}>Look at you. The advisors are taking full credit, naturally.</p>
        <p ${SUB}>It shifted</p>
        <p ${P}>Very common. Go re-read your reading, it tends to hit different once the situation moves. That second read is where the good stuff hides.</p>
        <p ${SUB}>It multiplied</p>
        <p ${P}>Problems do love company. Bring the new one in, the tools don't judge, and frankly the 8-ball has been asking about you.</p>
        <p ${P}>${CHECKIN_TIER_LINE[sku] || CHECKIN_TIER_LINE.single}</p>
        <p ${P}>Sixty seconds. Five perspectives. One clearer head.</p>
        ${button("Ask the tools &rarr;", cta)}`,
    }),
  };
}

export const EMAILS = {
  welcome: welcomeEmail,
  free_nudge: freeNudgeEmail,
  purchase: purchaseEmail,
  paid_checkin: paidCheckinEmail,
};

// ---------- unsubscribe links ----------

// Signed with a server secret so a link can only opt out the profile it was
// minted for. EMAIL_SECRET is preferred; the service-role key is the fallback
// so nothing breaks before the env var exists.
function secret() {
  return process.env.EMAIL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

export function unsubscribeToken(profileId) {
  return createHmac("sha256", secret()).update(String(profileId)).digest("hex").slice(0, 32);
}

export function unsubscribeUrlFor(profileId) {
  return `${SITE}/api/unsubscribe?u=${encodeURIComponent(profileId)}&t=${unsubscribeToken(profileId)}`;
}

export function verifyUnsubscribeToken(profileId, token) {
  return Boolean(profileId && token && unsubscribeToken(profileId) === String(token));
}

// ---------- sending ----------

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

// One Resend call. Throws on a non-2xx so callers decide what a failure costs.
export async function deliver({ to, subject, html, unsubscribeUrl }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      html,
      headers: unsubscribeUrl
        ? { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
        : undefined,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`resend ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json().catch(() => ({}));
  return data?.id || null;
}

// Renders and sends one lifecycle email to a profile. Skips silently when the
// address is missing or opted out. Returns "sent" | "skipped" | "failed".
export async function sendLifecycleEmail(admin, { profileId, email, kind, payload = {} }) {
  const render = EMAILS[kind];
  if (!render) throw new Error(`unknown email kind "${kind}"`);
  if (!email) return "skipped";
  const { data: profile } = await admin.from("profiles").select("email_opt_out").eq("id", profileId).maybeSingle();
  if (profile?.email_opt_out) return "skipped";
  const unsubscribeUrl = unsubscribeUrlFor(profileId);
  const { subject, html } = render({ ...payload, unsubscribeUrl });
  await deliver({ to: email, subject, html, unsubscribeUrl });
  return "sent";
}

// ---------- the queue (public.email_jobs) ----------

// Claims a (kind, ref) slot. Returns the row id, or null when that email was
// already claimed — the unique index is what makes sends exactly-once.
async function claim(admin, { profileId, kind, ref, payload, sendAt, status }) {
  const { data, error } = await admin
    .from("email_jobs")
    .insert({ profile_id: profileId, kind, ref, payload: payload || {}, send_at: sendAt, status })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return null; // unique_violation: already claimed
    throw new Error(`email_jobs insert failed: ${error.message}`);
  }
  return data?.id || null;
}

async function finish(admin, id, status, extra = {}) {
  const { error } = await admin.from("email_jobs").update({ status, ...extra }).eq("id", id);
  if (error) console.error(`emails: could not mark job ${id} ${status} —`, error.message);
}

// Send now, exactly once per (kind, ref). Never throws: email is a nicety and
// must not break a reading or a payment.
export async function sendNow(admin, { profileId, email, kind, ref, payload = {} }) {
  try {
    if (!emailConfigured()) {
      console.warn(`emails: RESEND_API_KEY not set — skipping ${kind} for ${profileId}`);
      return "skipped";
    }
    const id = await claim(admin, { profileId, kind, ref, payload, sendAt: new Date().toISOString(), status: "sending" });
    if (!id) return "duplicate";
    try {
      const result = await sendLifecycleEmail(admin, { profileId, email, kind, payload });
      await finish(admin, id, result, result === "sent" ? { sent_at: new Date().toISOString() } : {});
      return result;
    } catch (e) {
      await finish(admin, id, "failed", { error: String(e.message || e).slice(0, 500) });
      console.error(`emails: ${kind} to ${profileId} failed —`, e.message);
      return "failed";
    }
  } catch (e) {
    console.error(`emails: ${kind} for ${profileId} could not be queued —`, e.message);
    return "failed";
  }
}

// Queue a follow-up for later; the cron sends it. Exactly once per (kind, ref).
export async function enqueue(admin, { profileId, kind, ref, payload = {}, sendAt }) {
  try {
    const id = await claim(admin, { profileId, kind, ref, payload, sendAt: sendAt.toISOString(), status: "pending" });
    return id ? "queued" : "duplicate";
  } catch (e) {
    console.error(`emails: could not queue ${kind} for ${profileId} —`, e.message);
    return "failed";
  }
}

// Pending jobs of these kinds for this profile are dropped (paying moves a
// person out of the free sequence).
export async function cancelPending(admin, profileId, kinds) {
  const { error } = await admin
    .from("email_jobs")
    .update({ status: "cancelled" })
    .eq("profile_id", profileId)
    .eq("status", "pending")
    .in("kind", kinds);
  if (error) console.error(`emails: could not cancel ${kinds.join("/")} for ${profileId} —`, error.message);
}

export function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
