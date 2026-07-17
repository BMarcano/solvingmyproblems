// /api/stripe-webhook.js — Stripe fulfilment. The ONLY place credits are added
// and subscriptions are written.
//
// Signature is verified against the RAW body, so Vercel's body parser must stay
// off (see `config` below) — a parsed-and-restringified body changes the bytes
// and every signature check would fail.
//
// Idempotency: grant_credits() inserts one credit_ledger row per Stripe session
// id, and credit_ledger_stripe_ref_key makes a duplicate delivery a no-op at the
// database level. That means a retry can never double-credit an account, so we
// answer 5xx on a fulfilment error and let Stripe retry.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let stripeClient = null;
function stripe() {
  if (!stripeClient) stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

let adminClient = null;
function admin() {
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// Top-level on the pinned API version; per-item on 2025-03-31.basil and later.
function periodEndISO(subscription) {
  const ts = subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

function customerId(subscription) {
  return typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
}

// Order-independent: checkout.session.completed and customer.subscription.updated
// can arrive in either order, so resolve the user from the subscription metadata
// (set in create-checkout-session) and upsert by profile_id when we can.
async function upsertSubscription(subscription) {
  const patch = {
    stripe_customer_id: customerId(subscription),
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    current_period_end: periodEndISO(subscription),
    updated_at: new Date().toISOString(),
  };

  const uid = subscription.metadata?.supabase_uid;
  if (uid) {
    const { error } = await admin()
      .from("subscriptions")
      .upsert({ profile_id: uid, ...patch }, { onConflict: "profile_id" });
    if (error) throw new Error(`subscription upsert failed: ${error.message}`);
    return;
  }

  const { error } = await admin()
    .from("subscriptions")
    .update(patch)
    .eq("stripe_subscription_id", subscription.id);
  if (error) throw new Error(`subscription update failed: ${error.message}`);
}

async function handleCheckoutCompleted(session) {
  const uid = session.metadata?.supabase_uid;
  const sku = session.metadata?.sku;
  if (!uid || !sku) {
    console.error(`webhook: session ${session.id} has no supabase_uid/sku metadata — skipping`);
    return;
  }

  if (sku === "single" || sku === "fivepack") {
    const delta = sku === "single" ? 1 : 5;
    const reason = sku === "single" ? "purchase_single" : "purchase_fivepack";

    const { data: granted, error } = await admin().rpc("grant_credits", {
      p_user: uid,
      p_delta: delta,
      p_reason: reason,
      p_stripe_ref: session.id,
    });
    if (error) throw new Error(`grant_credits failed: ${error.message}`);

    if (granted === false) {
      console.log(`webhook: session ${session.id} already fulfilled — no-op`);
    } else {
      console.log(`webhook: +${delta} credits to ${uid} (${reason}, ${session.id})`);
    }
    return;
  }

  if (sku === "sub") {
    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (!subscriptionId) {
      console.error(`webhook: session ${session.id} has sku=sub but no subscription id`);
      return;
    }
    const subscription = await stripe().subscriptions.retrieve(subscriptionId);
    // The session carries the uid even if subscription_data.metadata didn't.
    subscription.metadata = { ...(subscription.metadata || {}), supabase_uid: uid };
    await upsertSubscription(subscription);
    console.log(`webhook: subscription ${subscriptionId} -> ${subscription.status} for ${uid}`);
    return;
  }

  console.error(`webhook: unknown sku "${sku}" on session ${session.id}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("webhook: missing Stripe/Supabase env vars");
    return res.status(500).json({ error: "server_misconfigured" });
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe().webhooks.constructEvent(
      rawBody,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("webhook: signature verification failed —", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`webhook: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await upsertSubscription(event.data.object);
        console.log(`webhook: subscription ${event.data.object.id} -> ${event.data.object.status}`);
        break;
      default:
        // Acknowledged and ignored on purpose.
        break;
    }
  } catch (e) {
    // Fulfilment is idempotent, so a retry is safe and preferable to silently
    // dropping a paid purchase.
    console.error(`webhook: handling ${event.type} (${event.id}) failed —`, e.message);
    return res.status(500).json({ error: "fulfilment_failed" });
  }

  return res.status(200).json({ received: true });
}
