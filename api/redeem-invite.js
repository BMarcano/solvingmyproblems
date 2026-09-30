// Activates a saved invitation for this browser's anonymous account.
import { createClient } from "@supabase/supabase-js";
import { readInvitationToken } from "./_invite-token.js";

let adminClient;
function admin() {
  if (!adminClient) {
    adminClient = createClient(
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return adminClient;
}

export async function redeemForUser(client, user, invite) {
  const { data: grant, error: grantError } = await client
    .from("comp_access").select("email, created_at").eq("email", invite.email).maybeSingle();
  if (grantError) throw new Error(`grant lookup failed: ${grantError.message}`);
  if (!grant || new Date(grant.created_at).toISOString() !== invite.created) return "expired";
  if (!user.is_anonymous && user.email?.trim().toLowerCase() !== invite.email) return "wrong_account";

  if (user.is_anonymous) {
    const { data: updated, error: updateError } = await client
      .from("profiles").update({ email: invite.email }).eq("id", user.id).select("id").maybeSingle();
    if (updateError || !updated) throw new Error(updateError?.message || "profile missing");
  }
  return "redeemed";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("redeem-invite: missing Supabase env vars");
    return res.status(503).json({ error: "access_unavailable" });
  }

  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return res.status(401).json({ error: "unauthorized" });
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  try {
    const { data: userData, error: userError } = await admin().auth.getUser(token);
    if (userError || !userData?.user) return res.status(401).json({ error: "unauthorized" });

    let invite;
    try {
      invite = readInvitationToken(body?.token);
    } catch {
      return res.status(410).json({ error: "invitation_expired" });
    }
    // The profile-email trigger may also materialize a comp subscription.
    // The access endpoints check the grant itself, so every device works.
    const result = await redeemForUser(admin(), userData.user, invite);
    if (result === "expired") return res.status(410).json({ error: "invitation_expired" });
    if (result === "wrong_account") return res.status(409).json({ error: "wrong_account" });
    return res.status(200).json({ redeemed: true });
  } catch (error) {
    console.error("redeem-invite failed:", error.message);
    return res.status(503).json({ error: "access_unavailable" });
  }
}
