// Admin-only invitation for an email already granted complimentary access.
import { createHash, timingSafeEqual } from "node:crypto";
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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isMaintenance = Boolean(serviceRoleKey) && timingSafeEqual(
    createHash("sha256").update(token).digest(),
    createHash("sha256").update(serviceRoleKey).digest(),
  );
  if (!supabaseUrl || (!isMaintenance && !anonKey) || !process.env.RESEND_API_KEY) {
    console.error("send-invite: Supabase or Resend is not configured");
    return res.status(503).json({ error: "Invitation email is not configured" });
  }

  try {
    // Maintenance callers must already possess this project's server key.
    // Query only the requested saved grant; possession never authorizes an
    // invitation to an arbitrary recipient. Browser admins keep the gated RPC.
    const baseUrl = supabaseUrl.replace(/\/$/, "");
    const grantQuery = new URLSearchParams({ select: "email,created_at", email: `eq.${email}`, limit: "1" });
    const grantsResponse = isMaintenance
      ? await fetch(`${baseUrl}/rest/v1/comp_access?${grantQuery}`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      })
      : await fetch(`${baseUrl}/rest/v1/rpc/admin_comp_list`, {
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
