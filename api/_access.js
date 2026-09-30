// Complimentary access is keyed by email. Anonymous visitors can have several
// different profile ids for the same address, so a subscription row on one id
// cannot be the source of truth for every device.

export function subscriptionIsActive(sub) {
  if (!sub || (sub.status !== "active" && sub.status !== "trialing")) return false;
  return !sub.current_period_end || new Date(sub.current_period_end).getTime() >= Date.now();
}

export async function getFullAccess(client, { userId, user, profileEmail }) {
  const { data: sub, error: subError } = await client
    .from("subscriptions")
    .select("status, current_period_end, stripe_subscription_id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (subError) throw new Error(`subscription lookup failed: ${subError.message}`);

  // Paid Stripe access remains independent of complimentary grants.
  if (sub?.stripe_subscription_id && subscriptionIsActive(sub)) {
    return { subscribed: true, comped: false };
  }

  // A real account's auth email takes precedence over a stale profile email.
  // Anonymous accounts use the address captured for their reading.
  const email = String((!user?.is_anonymous && user?.email) || profileEmail || "").trim().toLowerCase();
  if (!email) return { subscribed: false, comped: false };

  const { data: grant, error: grantError } = await client
    .from("comp_access")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (grantError) throw new Error(`complimentary access lookup failed: ${grantError.message}`);

  // A revoked grant must stop working even if an old anonymous profile still
  // has a materialized, non-Stripe subscription row.
  return { subscribed: Boolean(grant), comped: Boolean(grant) };
}
