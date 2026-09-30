// The current user's access, including an invitation saved for their email.
import { createClient } from "@supabase/supabase-js";
import { getFullAccess } from "./_access.js";

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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  if (!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("access: missing Supabase env vars");
    return res.status(503).json({ error: "access_unavailable" });
  }

  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return res.status(401).json({ error: "unauthorized" });

  try {
    const { data: userData, error: userError } = await admin().auth.getUser(token);
    if (userError || !userData?.user) return res.status(401).json({ error: "unauthorized" });
    const user = userData.user;
    const { data: profile, error: profileError } = await admin()
      .from("profiles")
      .select("email, credits, free_readings_used")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || !profile) throw new Error(profileError?.message || "profile missing");

    const access = await getFullAccess(admin(), { userId: user.id, user, profileEmail: profile.email });
    return res.status(200).json({
      email: profile.email || (!user.is_anonymous ? user.email : "") || "",
      credits: profile.credits,
      free_readings_used: profile.free_readings_used,
      subscribed: access.subscribed,
    });
  } catch (error) {
    console.error("access: lookup failed —", error.message);
    return res.status(503).json({ error: "access_unavailable" });
  }
}
