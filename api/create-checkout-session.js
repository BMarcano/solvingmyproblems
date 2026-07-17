// /api/create-checkout-session.js — opens a Stripe Checkout session.
//
// POST { sku } where sku is single | fivepack | sub.
// Anonymous users are rejected with 409 attach_email: the client converts the
// account (email + password on the SAME auth user, so credits and history carry
// over) and retries. Credits themselves are never granted here — only the
// webhook does that, after Stripe confirms payment.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SKUS = {
  single: { mode: "payment", priceEnv: "STRIPE_PRICE_SINGLE" },
  fivepack: { mode: "payment", priceEnv: "STRIPE_PRICE_FIVEPACK" },
  sub: { mode: "subscription", priceEnv: "STRIPE_PRICE_SUB" },
};

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

// Reuse the customer we already made for this user, otherwise create one and
// remember it. Keyed by supabase_uid so a user never ends up with two customers.
async function findOrCreateCustomer(userId, email) {
  const { data: row, error } = await admin()
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (error) console.warn("checkout: customer lookup failed —", error.message);
  if (row?.stripe_customer_id) return row.stripe_customer_id;

  const customer = await stripe().customers.create({
    email: email || undefined,
    metadata: { supabase_uid: userId },
  });

  const { error: upsertError } = await admin()
    .from("subscriptions")
    .upsert({ profile_id: userId, stripe_customer_id: customer.id }, { onConflict: "profile_id" });
  if (upsertError) {
    // Not fatal for this checkout, but the next one would create a second
    // customer for the same user, so make it visible.
    console.error("checkout: could not store stripe_customer_id —", upsertError.message);
  }
  return customer.id;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!process.env.STRIPE_SECRET_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("checkout: missing Stripe/Supabase env vars");
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

  const sku = body.sku;
  const config = SKUS[sku];
  if (!config) return res.status(400).json({ error: "invalid_sku" });

  const price = process.env[config.priceEnv];
  if (!price) {
    console.error(`checkout: ${config.priceEnv} is not set`);
    return res.status(500).json({ error: "server_misconfigured" });
  }

  // Verify the caller.
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "unauthorized" });

  const { data: userData, error: userError } = await admin().auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: "unauthorized" });
  const user = userData.user;

  // Anonymous accounts can't own a purchase — the client attaches an email to
  // this same user id first, so credits and history survive the conversion.
  if (user.is_anonymous) return res.status(409).json({ error: "attach_email" });

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const customerId = await findOrCreateCustomer(user.id, user.email);

    const session = await stripe().checkout.sessions.create({
      mode: config.mode,
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      // The webhook reads these to fulfil the purchase.
      metadata: { supabase_uid: user.id, sku },
      ...(config.mode === "subscription"
        ? { subscription_data: { metadata: { supabase_uid: user.id } } }
        : {}),
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("checkout: stripe error —", e.message);
    return res.status(502).json({ error: "checkout_failed" });
  }
}
