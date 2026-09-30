// Admin-only invitation for an email already granted complimentary access.
import { deliver, invitationEmail, SITE } from "./_emails.js";
import { createInvitationToken } from "./_invite-token.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Invalid email" });
  }

  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return res.status(401).json({ error: "Not signed in" });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey || !process.env.RESEND_API_KEY) {
    console.error("send-invite: Supabase or Resend is not configured");
    return res.status(503).json({ error: "Invitation email is not configured" });
  }

  try {
    // The RPC is gated by is_admin() and exposes only saved grants. Supabase
    // verifies the caller's JWT, so this cannot email an arbitrary address.
    const grantsResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/admin_comp_list`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (grantsResponse.status === 401) return res.status(401).json({ error: "Session expired" });
    if (!grantsResponse.ok) {
      console.error("send-invite: grant lookup failed", grantsResponse.status, await grantsResponse.text());
      return res.status(502).json({ error: "Could not verify the access grant" });
    }
    const grants = await grantsResponse.json();
    const grant = Array.isArray(grants) ? grants.find((item) => item.email === email) : null;
    if (!grant) {
      return res.status(403).json({ error: "No access grant found for this email" });
    }

    const inviteLink = `${SITE}/?invite=${createInvitationToken(email, grant.created_at)}`;
    const { subject, html } = invitationEmail({ inviteLink });
    const id = await deliver({ to: email, subject, html });
    return res.status(200).json({ sent: true, id });
  } catch (error) {
    console.error("send-invite failed:", error);
    return res.status(502).json({ error: "Invitation email could not be sent" });
  }
}
