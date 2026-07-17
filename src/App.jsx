import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Moon, Hash, Compass, CircleDot, ScrollText, RefreshCw, Share2, Heart, X, Lock, Sun } from "lucide-react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

// ------------------------------------------------------------------
// SOLVING MY PROBLEMS — solvingmyproblems.com
// Type a problem, add your birth details, and five old tools of
// wisdom (tarot, I Ching, numerology, astrology, the 8-ball) weigh in.
// Tasteful, fun, and quietly practical. For reflection & entertainment.
// Design: "The Midnight Parlor" — deep indigo, celestial gold,
// Cormorant Garamond display, cards that deal themselves onto the table.
// ------------------------------------------------------------------

const FONTS = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Karla:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap');
    :root { color-scheme: dark; background: #12132B; }
    .smp-root { font-family: 'Karla', sans-serif; color-scheme: dark; }
    .smp-display { font-family: 'Cormorant Garamond', serif; }
    .smp-mono { font-family: 'Space Mono', monospace; }
    /* Native date/time widgets render at their own heights — pin every Field to
       one height so the birthdate / birth time / birthplace row lines up. */
    .smp-field { height: 46px; -webkit-appearance: none; appearance: none; }
    .smp-field::placeholder { color: #8E8FB8; opacity: 1; }
    .smp-field::-webkit-calendar-picker-indicator { opacity: .55; cursor: pointer; }
    .smp-field::-webkit-date-and-time-value { text-align: left; }
    @keyframes dealIn { from { opacity: 0; transform: translateY(24px) rotate(var(--tilt, 0deg)) scale(.96); } to { opacity: 1; transform: translateY(0) rotate(var(--tilt, 0deg)) scale(1); } }
    .deal { animation: dealIn .7s cubic-bezier(.2,.8,.2,1) both; }
    @keyframes twinkle { 0%,100% { opacity: .25; } 50% { opacity: .9; } }
    .star { animation: twinkle var(--tw, 3s) ease-in-out infinite; }
    @keyframes floaty { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes moonGlow { 0%,100% { filter: drop-shadow(0 0 4px rgba(232,196,104,.25)); } 50% { filter: drop-shadow(0 0 11px rgba(232,196,104,.55)); } }
    .floaty { animation: floaty 4s ease-in-out infinite, moonGlow 5s ease-in-out infinite; }
    /* Sections rise softly into place on load. */
    @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
    .rise { animation: rise .8s cubic-bezier(.2,.8,.2,1) both; }
    /* A band of light sweeps the gold CTA every few seconds. */
    @keyframes sheen { 0%, 74% { transform: translateX(-130%); } 92%, 100% { transform: translateX(130%); } }
    .cta-sheen { position: absolute; inset: 0; background: linear-gradient(115deg, transparent 42%, rgba(255,255,255,.35) 50%, transparent 58%); transform: translateX(-130%); animation: sheen 5.5s ease-in-out infinite; pointer-events: none; }
    button:disabled .cta-sheen { animation: none; }
    @keyframes spinSlow { to { transform: rotate(360deg); } }
    .spin-slow { animation: spinSlow 1.6s linear infinite; }
    /* Sky layers ease toward the cursor (JS sets the transform; the transition
       gives it the smooth trailing feel). */
    .parallax-layer { transition: transform .6s cubic-bezier(.22,1,.36,1); will-change: transform; }
    /* Constellations breathe very faintly among the stars. */
    @keyframes constellationPulse { 0%,100% { opacity: .1; } 50% { opacity: .32; } }
    .constellation { opacity: .14; animation: constellationPulse var(--cd, 11s) ease-in-out infinite; }
    /* Reading cards lift toward you on hover. !important beats the deal
       animation's fill-mode transform and the inline resting shadow. */
    .tool-card { transform: rotate(var(--tilt, 0deg)); transition: transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s ease; }
    .tool-card:hover { transform: translateY(-4px) rotate(var(--tilt, 0deg)) scale(1.015) !important; box-shadow: 0 18px 50px rgba(0,0,0,.45), 0 0 24px rgba(232,196,104,.14) !important; }
    /* A soft light passes through the gold word in the title. Edge stops match
       so the repeating tile is seamless at any background-position. */
    @keyframes goldShimmer { 0% { background-position: 0 0; } 100% { background-position: 200% 0; } }
    .gold-shimmer { background: linear-gradient(100deg, #E8C468 40%, #FFF3CF 50%, #E8C468 60%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: goldShimmer 7s linear infinite; }
    /* The sky moves: each layer is doubled vertically and scrolls one full
       height, so the loop is seamless. Twinkle stays per-star. */
    @keyframes starDrift { from { transform: translate3d(0,0,0); } to { transform: translate3d(0,-50%,0); } }
    .star-drift { animation: starDrift var(--speed, 180s) linear infinite; }
    @keyframes shoot { 0% { transform: translate3d(0,0,0) rotate(330deg); opacity: 0; } 2% { opacity: .9; } 9% { transform: translate3d(-46vw, 26vw, 0) rotate(330deg); opacity: 0; } 100% { transform: translate3d(-46vw, 26vw, 0) rotate(330deg); opacity: 0; } }
    .shooting-star { width: clamp(48px, 12vw, 110px); height: 2px; border-radius: 999px; background: linear-gradient(90deg, rgba(232,196,104,.9), rgba(232,196,104,0)); opacity: 0; animation: shoot var(--sd, 18s) linear infinite; animation-delay: var(--sdelay, 0s); }
    @keyframes nebulaPulse { 0%,100% { transform: translate3d(0,0,0) scale(1); opacity: .45; } 50% { transform: translate3d(-2%,3%,0) scale(1.07); opacity: .8; } }
    .nebula { opacity: .45; animation: nebulaPulse var(--np, 48s) ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) { .deal, .star, .floaty, .star-drift, .shooting-star, .nebula, .rise, .cta-sheen, .spin-slow, .constellation, .gold-shimmer { animation: none; } .tool-card, .parallax-layer { transition: none; } }
  `}</style>
);

const P = {
  night: "#12132B",
  nightSoft: "#1C1E3F",
  card: "#1F2148",
  gold: "#E8C468",
  goldSoft: "rgba(232,196,104,.14)",
  lavender: "#B8A9E8",
  rose: "#E88BA3",
  parchment: "#F4EFE4",
  faint: "#8E8FB8",
};

// Deterministic star field: a fixed-seed PRNG (stable across every render and
// reload) plus best-candidate sampling — each star takes the most isolated of
// 10 candidate spots, so the sky scatters organically with no bands, no lines,
// and no accidental overlaps.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STARS = (() => {
  const rand = mulberry32(0x5eed);
  const pts = [];
  for (let i = 0; i < 110; i++) {
    let best = null;
    let bestD = -1;
    for (let c = 0, tries = i === 0 ? 1 : 10; c < tries; c++) {
      const cand = [rand() * 100, rand() * 100];
      let d = Infinity;
      for (const p of pts) {
        // toroidal distance: the field tiles vertically for the drift loop
        const dx = Math.min(Math.abs(cand[0] - p[0]), 100 - Math.abs(cand[0] - p[0]));
        const dy = Math.min(Math.abs(cand[1] - p[1]), 100 - Math.abs(cand[1] - p[1]));
        d = Math.min(d, dx * dx + dy * dy);
      }
      if (d > bestD) { bestD = d; best = cand; }
    }
    pts.push(best);
  }
  return pts.map(([left, top], i) => ({
    left: +left.toFixed(2),
    // compressed into [0.3, 99.3] so no star straddles the drift-loop seam
    top: +(0.3 + top * 0.99).toFixed(2),
    size: [1, 1.5, 2.5][i % 3] + (i % 11 === 0 ? 0.5 : 0),
    bright: i % 11 === 0, // a few stars get a soft halo
    tw: +(2.2 + rand() * 2.8).toFixed(2),
    delay: -+(rand() * 8).toFixed(2), // negative delays de-sync the twinkling
  }));
})();

// Three parallax layers: the farthest stars are the smallest and crawl, the
// nearest are the biggest and drift fastest.
const STAR_LAYERS = [
  { speed: "320s", stars: STARS.filter((_, i) => i % 3 === 0) },
  { speed: "230s", stars: STARS.filter((_, i) => i % 3 === 1) },
  { speed: "150s", stars: STARS.filter((_, i) => i % 3 === 2) },
];

// Faint constellations traced among the mid-layer stars; they drift with them.
const CONSTELLATIONS = [
  { left: 8, top: 12, w: 120, h: 60, cd: "9s", pts: [[4, 44], [22, 32], [40, 26], [58, 24], [74, 30], [92, 26], [114, 12]] },
  { left: 66, top: 40, w: 90, h: 34, cd: "12s", pts: [[2, 26], [20, 4], [42, 20], [64, 2], [86, 16]] },
  { left: 30, top: 72, w: 60, h: 64, cd: "10s", pts: [[30, 2], [54, 26], [30, 60], [6, 26], [30, 2]] },
];

// Occasional shooting stars — staggered cycles so a streak stays an event, not noise.
const SHOOTING_STARS = [
  { left: 72, top: 4, sd: 14, sdelay: 3 },
  { left: 94, top: 18, sd: 19, sdelay: 9 },
  { left: 48, top: 2, sd: 23, sdelay: 15 },
  { left: 85, top: 40, sd: 27, sdelay: 6 },
  { left: 60, top: 12, sd: 31, sdelay: 21 },
];

// Slow-breathing nebulas behind everything, in the palette's own hues.
const NEBULAS = [
  { size: 520, style: { left: "-10%", top: "-6%" }, color: "rgba(184,169,232,.10)", np: "46s" },
  { size: 640, style: { right: "-16%", top: "26%" }, color: "rgba(232,196,104,.06)", np: "58s" },
  { size: 430, style: { left: "16%", bottom: "-10%" }, color: "rgba(232,139,163,.05)", np: "52s" },
  { size: 380, style: { left: "38%", top: "6%" }, color: "rgba(184,169,232,.07)", np: "64s" },
];

async function consultTheTools({ problem, birthdate, birthtime, birthplace, partnerName, partnerBirthdate, token }) {
  // The reading engine (the Anthropic call plus the prompt and its safety
  // guardrails) runs server-side in /api/consult, so the API key never reaches
  // the browser and every reading-consumption decision stays on the server.
  const response = await fetch("/api/consult", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      problem,
      birthdate,
      birthtime,
      birthplace,
      partnerName,
      partnerBirthdate,
      mode: partnerBirthdate ? "duo" : "solo",
    }),
  });
  // Out of free readings and credits — the caller opens the paywall.
  if (response.status === 402) {
    const paymentRequired = new Error("payment_required");
    paymentRequired.code = "payment_required";
    throw paymentRequired;
  }
  if (!response.ok) throw new Error(`consult failed (${response.status})`);
  return response.json();
}

// ---------- Daily Card: subscriber ritual — one-card morning pull ----------
async function pullDailyCard({ token }) {
  // Subscriber daily pull, generated and cached per day server-side in
  // /api/daily-card (wired up in a later milestone; gated on an active sub).
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const response = await fetch("/api/daily-card", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ day }),
  });
  if (!response.ok) throw new Error(`daily-card failed (${response.status})`);
  return response.json();
}

// A subscription only counts while Stripe says it is live.
function subscriptionIsActive(sub) {
  if (!sub) return false;
  if (sub.status !== "active" && sub.status !== "trialing") return false;
  if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) return false;
  return true;
}

async function getAccessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

function Label({ children }) {
  return <p className="smp-mono text-[10px] tracking-[.25em] uppercase mb-2" style={{ color: P.gold }}>{children}</p>;
}

function Field({ label, ...props }) {
  // Empty date/time inputs show their own dd/mm/aaaa · --:-- hint text; tint it
  // like a placeholder until there is a real value. Focus also lifts the tint:
  // date inputs report value "" until a COMPLETE date is typed, and without
  // this the segments the user is mid-typing would render as ghost text.
  const [focused, setFocused] = useState(false);
  const filled = props.value !== undefined && props.value !== null && props.value !== "";
  return (
    // justify-end anchors label+input to the bottom of the grid cell, so when a
    // long label wraps to two lines the inputs in that row still line up.
    <div className="flex flex-col justify-end">
      <Label>{label}</Label>
      <input
        {...props}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        className="smp-field w-full rounded-lg px-4 text-sm outline-none border transition-colors focus:border-current"
        style={{ background: P.nightSoft, borderColor: "#2E3060", color: filled || focused ? P.parchment : P.faint }}
      />
    </div>
  );
}

function ToolCard({ icon: Icon, tool, title, tilt, delay, children }) {
  return (
    <div
      className="deal tool-card rounded-2xl p-5 relative"
      style={{ background: P.card, border: "1px solid #2E3060", "--tilt": tilt, animationDelay: delay, boxShadow: "0 12px 40px rgba(0,0,0,.35)" }}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: P.goldSoft }}>
          <Icon size={16} style={{ color: P.gold }} />
        </div>
        <div>
          <p className="smp-mono text-[9px] tracking-[.25em] uppercase" style={{ color: P.faint }}>{tool}</p>
          <h3 className="smp-display text-xl font-semibold leading-tight" style={{ color: P.parchment }}>{title}</h3>
        </div>
      </div>
      <div className="mt-3 text-sm leading-relaxed" style={{ color: "#C9C7E3" }}>{children}</div>
    </div>
  );
}

export default function SolvingMyProblems() {
  const [problem, setProblem] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [birthtime, setBirthtime] = useState("");
  const [birthplace, setBirthplace] = useState("");
  const [reading, setReading] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [readingsUsed, setReadingsUsed] = useState(0);
  // --- Monetization: first reading free, then credits or subscription ---
  const [credits, setCredits] = useState(0);
  const [subscribed, setSubscribed] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // --- Compatibility mode ---
  const [mode, setMode] = useState("solo"); // solo | duo
  const [partnerName, setPartnerName] = useState("");
  const [partnerBirthdate, setPartnerBirthdate] = useState("");
  // --- Daily Card (subscriber ritual) ---
  const [daily, setDaily] = useState(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  // --- Account + checkout ---
  const [user, setUser] = useState(null);
  const [checkoutBusy, setCheckoutBusy] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [authStep, setAuthStep] = useState(""); // "" | "attach" | "signin"
  const [pendingSku, setPendingSku] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNote, setAuthNote] = useState("");

  const hasEmail = Boolean(user && !user.is_anonymous && user.email);

  const skyRef = useRef(null);

  // The sky leans a few pixels toward the cursor, each layer by a different
  // depth. Direct DOM writes (no React re-render per mouse move), rAF-throttled,
  // skipped on touch devices and under prefers-reduced-motion; the CSS
  // transition on .parallax-layer supplies the smooth trailing feel.
  useEffect(() => {
    const sky = skyRef.current;
    if (!sky) return undefined;
    if (!window.matchMedia("(hover: hover)").matches) return undefined;
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMq.matches) return undefined;
    const layers = sky.querySelectorAll("[data-parallax]");
    let raf = 0;
    let mx = 0;
    let my = 0;
    const apply = () => {
      raf = 0;
      layers.forEach((el) => {
        const depth = Number(el.dataset.parallax) || 0;
        el.style.transform = `translate3d(${(-mx * depth).toFixed(1)}px, ${(-my * depth).toFixed(1)}px, 0)`;
      });
    };
    const onMove = (e) => {
      if (reduceMq.matches) return; // honors an OS toggle made mid-session
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Boot: anonymous-first. The free reading needs no login, and because the
  // anonymous user is a real auth.users row, the profiles trigger, RLS and the
  // free-reading counter all work identically. At purchase the SAME account is
  // converted, so credits and history carry over.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      let session = data?.session ?? null;
      if (!session) {
        const { data: anon, error: anonError } = await supabase.auth.signInAnonymously();
        if (anonError) console.error("anonymous sign-in failed:", anonError.message);
        session = anon?.session ?? null;
      }
      if (!cancelled) setUser(session?.user ?? null);
    })();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      cancelled = true;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  // Real credits / subscription / free-reading counter, straight from the
  // tables (select-own via RLS). The server is what actually decides.
  const refreshProfile = useCallback(async () => {
    if (!supabase || !user) return null;
    const [{ data: profile }, { data: sub }] = await Promise.all([
      supabase.from("profiles").select("free_readings_used, credits").eq("id", user.id).maybeSingle(),
      supabase.from("subscriptions").select("status, current_period_end").eq("profile_id", user.id).maybeSingle(),
    ]);
    const active = subscriptionIsActive(sub);
    if (profile) {
      setCredits(profile.credits ?? 0);
      setReadingsUsed(profile.free_readings_used ?? 0);
    }
    setSubscribed(active);
    return { credits: profile?.credits ?? 0, subscribed: active };
  }, [user]);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  // Back from Stripe. The webhook may still be in flight, so poll briefly
  // instead of showing a stale balance.
  useEffect(() => {
    if (!user) return undefined;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (!checkout) return undefined;
    window.history.replaceState({}, "", window.location.pathname);
    if (checkout !== "success") return undefined;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 6 && !cancelled; i++) {
        const state = await refreshProfile();
        if (state && (state.credits > 0 || state.subscribed)) return;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, refreshProfile]);

  async function handleConsult() {
    // The server decides, in order: subscription, then a credit, then the free
    // reading. A 402 means it is time to pay.
    setLoading(true);
    setError("");
    try {
      const r = await consultTheTools({
        problem, birthdate, birthtime, birthplace,
        partnerName: mode === "duo" ? partnerName : "",
        partnerBirthdate: mode === "duo" ? partnerBirthdate : "",
        token: await getAccessToken(),
      });
      setReading(r);
      await refreshProfile();
    } catch (e) {
      if (e.code === "payment_required") setShowPaywall(true);
      else setError("The tools are being temperamental. Give it another try in a moment.");
    }
    setLoading(false);
  }

  async function startCheckout(sku) {
    setCheckoutError("");
    setCheckoutBusy(sku);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sku }),
      });
      // Anonymous account: attach an email to this same user first, then retry.
      if (response.status === 409) {
        setPendingSku(sku);
        setAuthError("");
        setAuthNote("");
        setAuthStep("attach");
        return;
      }
      if (!response.ok) throw new Error(`checkout failed (${response.status})`);
      const { url } = await response.json();
      window.location.href = url;
    } catch (e) {
      setCheckoutError("Checkout is being temperamental. Give it another try in a moment.");
    } finally {
      setCheckoutBusy("");
    }
  }

  // Converts the anonymous account in place: same user id, so credits and
  // history survive.
  async function attachEmail(e) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    setAuthNote("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        email: authEmail,
        password: authPassword,
      });
      if (updateError) throw updateError;
      const { data } = await supabase.auth.getUser();
      if (data?.user?.is_anonymous) {
        // This project has email confirmation on: the account only converts
        // once the link is clicked.
        setAuthNote("Check your inbox to confirm that address, then choose your plan again.");
        return;
      }
      setUser(data?.user ?? null);
      setAuthStep("");
      const sku = pendingSku;
      setPendingSku("");
      if (sku) await startCheckout(sku);
    } catch (err) {
      setAuthError(err.message || "Could not save that address. Try another one.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signIn(e) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    setAuthNote("");
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });
      if (signInError) throw signInError;
      setAuthStep("");
      setAuthPassword("");
    } catch (err) {
      setAuthError(err.message || "That email and password did not match.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function forgotPassword() {
    if (!authEmail) {
      setAuthError("Enter your email first.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    setAuthNote("");
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(authEmail, {
        redirectTo: window.location.origin,
      });
      if (resetError) throw resetError;
      setAuthNote("Recovery link sent. Check your inbox.");
    } catch (err) {
      setAuthError(err.message || "Could not send that. Try again in a moment.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setReading(null);
    setDaily(null);
    setCredits(0);
    setSubscribed(false);
    setReadingsUsed(0);
    setAuthEmail("");
    setAuthPassword("");
    // Straight back to a fresh anonymous session so the app keeps working.
    const { data } = await supabase.auth.signInAnonymously();
    setUser(data?.session?.user ?? null);
  }

  return (
    <div className="smp-root min-h-screen w-full relative overflow-hidden" style={{ background: P.night }}>
      {FONTS}
      {/* the sky — nebulas, three drifting star layers with constellations,
          shooting stars; the whole thing leans gently toward the cursor */}
      <div ref={skyRef} className="absolute inset-0 overflow-hidden pointer-events-none">
        <div data-parallax="6" className="parallax-layer absolute inset-0">
          {NEBULAS.map((n, i) => (
            <div key={i} className="nebula absolute rounded-full" style={{ width: n.size, height: n.size, background: `radial-gradient(circle, ${n.color}, transparent 65%)`, "--np": n.np, ...n.style }} />
          ))}
        </div>
        {STAR_LAYERS.map((layer, l) => (
          <div key={l} data-parallax={[10, 18, 30][l]} className="parallax-layer absolute inset-0">
            <div className="star-drift absolute inset-x-0 top-0" style={{ height: "200%", "--speed": layer.speed }}>
              {[0, 1].map((half) => (
                <div key={half} className="absolute inset-x-0" style={{ top: `${half * 50}%`, height: "50%" }}>
                  {l === 1 && CONSTELLATIONS.map((c, ci) => (
                    <svg key={`c${ci}`} className="constellation absolute" style={{ left: `${c.left}%`, top: `${c.top}%`, "--cd": c.cd }} width={c.w} height={c.h} viewBox={`0 0 ${c.w} ${c.h}`} fill="none" aria-hidden="true">
                      <polyline points={c.pts.map((p) => p.join(",")).join(" ")} stroke={P.gold} strokeOpacity=".45" strokeWidth=".8" />
                      {c.pts.map(([x, y], pi) => (
                        <circle key={pi} cx={x} cy={y} r="1.5" fill={P.gold} />
                      ))}
                    </svg>
                  ))}
                  {layer.stars.map((s, i) => (
                    <div key={i} className="star absolute rounded-full" style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, background: P.gold, boxShadow: s.bright ? "0 0 6px 1px rgba(232,196,104,.7)" : undefined, animationDelay: `${s.delay}s`, "--tw": `${s.tw}s` }} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div data-parallax="24" className="parallax-layer absolute inset-0">
          {SHOOTING_STARS.map((s, i) => (
            <div key={i} className="shooting-star absolute" style={{ left: `${s.left}%`, top: `${s.top}%`, "--sd": `${s.sd}s`, "--sdelay": `${s.sdelay}s` }} />
          ))}
        </div>
      </div>

      <div className="relative max-w-2xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="text-center rise">
          <div className="floaty inline-block"><Moon size={28} style={{ color: P.gold }} /></div>
          <h1 className="smp-display text-5xl font-semibold mt-3" style={{ color: P.parchment }}>
            Solving <em className="gold-shimmer" style={{ color: P.gold }}>My</em> Problems
          </h1>
          <p className="text-sm mt-3 max-w-md mx-auto leading-relaxed" style={{ color: P.faint }}>
            Bring the tools of five ancient advisors to one modern problem. Tarot, the I Ching, numerology, the stars — and, for tie-breaks, the 8-ball.
          </p>
        </header>

        {/* Input */}
        {!reading && (
          <section className="mt-10 rounded-3xl p-6 space-y-5 rise" style={{ background: P.nightSoft, border: "1px solid #2E3060", animationDelay: ".12s" }}>
            <div>
              <Label>The problem, in your own words</Label>
              <textarea
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                rows={3}
                placeholder="e.g. I can't decide whether to leave my stable job for my own business…"
                className="w-full rounded-lg px-4 py-3 text-sm outline-none border resize-none"
                style={{ background: P.night, borderColor: "#2E3060", color: P.parchment }}
              />
            </div>
            {/* Solo vs compatibility */}
            <div>
              <Label>Who is this reading about?</Label>
              <div className="flex gap-2">
                {[["solo", "Just me"], ["duo", "Me + someone else"]].map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="flex-1 rounded-lg py-2.5 text-xs font-bold border transition-all active:scale-[.98] flex items-center justify-center gap-1.5"
                    style={{ background: mode === m ? P.goldSoft : P.night, borderColor: mode === m ? P.gold : "#2E3060", color: mode === m ? P.gold : P.faint }}
                  >
                    {m === "duo" && <Heart size={12} />} {label}
                  </button>
                ))}
              </div>
            </div>
            {mode === "duo" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Their name · optional" placeholder="First name" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} />
                <Field label="Their birthdate" type="date" value={partnerBirthdate} onChange={(e) => setPartnerBirthdate(e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Birthdate" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
              <Field label="Birth time · optional" type="time" value={birthtime} onChange={(e) => setBirthtime(e.target.value)} />
              <Field label="Birthplace · optional" placeholder="City" value={birthplace} onChange={(e) => setBirthplace(e.target.value)} />
            </div>
            {error && <p className="text-sm" style={{ color: P.rose }}>{error}</p>}
            <button
              disabled={!problem.trim() || loading}
              onClick={handleConsult}
              className="relative overflow-hidden w-full rounded-xl py-4 font-bold text-sm tracking-wide transition-all active:scale-[.99] disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: P.gold, color: P.night }}
            >
              <span className="cta-sheen" aria-hidden="true" />
              <Sparkles size={16} className={loading ? "spin-slow" : ""} />
              {loading ? "Consulting the tools…" : "Consult the tools"}
            </button>
            <p className="text-center text-[11px]" style={{ color: P.faint }}>
              For reflection and entertainment — the practical steps, though, are real.
            </p>
          </section>
        )}

        {/* Daily Card — the subscriber ritual */}
        {!reading && (
          <section className="mt-6 rounded-3xl p-5 rise" style={{ background: P.nightSoft, border: "1px solid #2E3060", animationDelay: ".24s" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sun size={16} style={{ color: P.gold }} />
                <p className="smp-mono text-[10px] tracking-[.25em] uppercase" style={{ color: P.gold }}>Your Daily Card</p>
              </div>
              {!subscribed && <Lock size={13} style={{ color: P.faint }} />}
            </div>
            {subscribed ? (
              daily ? (
                <div className="mt-3">
                  <h3 className="smp-display text-2xl font-semibold" style={{ color: P.parchment }}>{daily.card}</h3>
                  <p className="text-sm mt-2 leading-relaxed" style={{ color: "#C9C7E3" }}>{daily.message}</p>
                  <p className="text-sm mt-2 font-bold" style={{ color: P.lavender }}>Today: {daily.nudge}</p>
                </div>
              ) : (
                <button
                  disabled={dailyLoading}
                  onClick={async () => { setDailyLoading(true); try { setDaily(await pullDailyCard({ token: await getAccessToken() })); } catch {} setDailyLoading(false); }}
                  className="mt-3 w-full rounded-xl py-3 text-sm font-bold transition-all active:scale-[.99]"
                  style={{ background: P.goldSoft, color: P.gold, border: `1px solid ${P.gold}55` }}
                >
                  {dailyLoading ? "Pulling today's card…" : "Pull today's card ✦"}
                </button>
              )
            ) : (
              <button onClick={() => setShowPaywall(true)} className="mt-2 text-left w-full">
                <p className="text-sm" style={{ color: P.faint }}>
                  One card, every morning, read against your chart. <span style={{ color: P.gold }}>Unlock with unlimited · $4.99/mo →</span>
                </p>
              </button>
            )}
          </section>
        )}

        {/* Reading */}
        {reading && (
          <section className="mt-10 space-y-4">
            <p className="smp-mono text-center text-[10px] tracking-[.3em] uppercase" style={{ color: P.faint }}>
              A reading on — “{problem.length > 60 ? problem.slice(0, 60) + "…" : problem}”
            </p>

            <ToolCard icon={ScrollText} tool="Tarot" title={reading.tarot?.card} tilt="-1deg" delay="0s">
              <p>{reading.tarot?.meaning}</p>
              <p className="mt-2 font-bold" style={{ color: P.lavender }}>{reading.tarot?.advice}</p>
            </ToolCard>

            <ToolCard icon={Compass} tool="I Ching" title={`${reading.iching?.symbol} ${reading.iching?.number} · ${reading.iching?.name}`} tilt="1.2deg" delay=".15s">
              <p>{reading.iching?.reading}</p>
            </ToolCard>

            <ToolCard icon={Hash} tool="Numerology" title={`Life Path ${reading.numerology?.lifePath}`} tilt="-0.8deg" delay=".3s">
              <p>{reading.numerology?.insight}</p>
            </ToolCard>

            <ToolCard icon={Moon} tool="Astrology" title={reading.astrology?.sign} tilt="0.9deg" delay=".45s">
              <p>{reading.astrology?.note}</p>
            </ToolCard>

            <ToolCard icon={CircleDot} tool="The 8-Ball · tie-break" title={`“${reading.eightball}”`} tilt="-1.4deg" delay=".6s">
              <p style={{ color: P.faint }}>The 8-ball does not elaborate. It never has.</p>
            </ToolCard>

            {/* Synthesis — the practical payoff */}
            <div className="deal rounded-3xl p-6" style={{ background: P.goldSoft, border: `1px solid ${P.gold}55`, animationDelay: ".8s" }}>
              <Label>What the tools agree on</Label>
              <h2 className="smp-display text-3xl font-semibold" style={{ color: P.parchment }}>{reading.synthesis?.headline}</h2>
              <ol className="mt-4 space-y-3">
                {(reading.synthesis?.steps || []).map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed" style={{ color: "#E4E1F5" }}>
                    <span className="smp-mono shrink-0" style={{ color: P.gold }}>{["I.", "II.", "III."][i] || `${i + 1}.`}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShareOpen(true)}
                className="flex-1 rounded-xl py-3.5 font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[.99]"
                style={{ background: P.gold, color: P.night }}
              >
                <Share2 size={15} /> Share this reading
              </button>
              <button
                onClick={() => { setReading(null); setProblem(""); }}
                className="flex-1 rounded-xl py-3.5 font-bold text-sm flex items-center justify-center gap-2 border transition-all active:scale-[.99]"
                style={{ borderColor: "#2E3060", color: P.parchment }}
              >
                <RefreshCw size={15} /> New problem
              </button>
            </div>
            {!subscribed && (
              <button onClick={() => setShowPaywall(true)} className="w-full text-center text-xs font-bold pt-1" style={{ color: P.faint }}>
                {credits > 0 ? `${credits} reading credit${credits === 1 ? "" : "s"} left · ` : ""}Unlimited + Daily Card · <span style={{ color: P.gold }}>$4.99/mo</span>
              </button>
            )}
          </section>
        )}

        {/* Share card modal — designed to be screenshot / natively shared */}
        {shareOpen && reading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(10,10,26,.85)" }} onClick={() => setShareOpen(false)}>
            <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
              <div className="rounded-3xl p-7 text-center relative overflow-hidden" style={{ background: `linear-gradient(160deg, ${P.nightSoft}, ${P.night})`, border: `1px solid ${P.gold}66` }}>
                <Moon size={20} className="mx-auto" style={{ color: P.gold }} />
                <p className="smp-mono text-[9px] tracking-[.3em] uppercase mt-3" style={{ color: P.faint }}>The tools have spoken</p>
                <h2 className="smp-display text-3xl font-semibold mt-2 leading-tight" style={{ color: P.parchment }}>{reading.synthesis?.headline}</h2>
                <div className="smp-mono text-[11px] mt-4 space-y-1" style={{ color: "#C9C7E3" }}>
                  <p>{reading.tarot?.card}</p>
                  <p>{reading.iching?.symbol} {reading.iching?.name} · Life Path {reading.numerology?.lifePath}</p>
                  <p style={{ color: P.gold }}>8-ball: “{reading.eightball}”</p>
                </div>
                <p className="smp-mono text-[9px] tracking-[.25em] uppercase mt-5" style={{ color: P.faint }}>solvingmyproblems.com</p>
              </div>
              <button
                onClick={async () => {
                  const text = `🔮 ${reading.synthesis?.headline}\n${reading.tarot?.card} · ${reading.iching?.symbol} ${reading.iching?.name} · 8-ball: “${reading.eightball}”\nGet a reading on your problem → solvingmyproblems.com`;
                  try { if (navigator.share) { await navigator.share({ text }); } else { await navigator.clipboard.writeText(text); } } catch {}
                }}
                className="mt-3 w-full rounded-xl py-3.5 font-bold text-sm transition-all active:scale-[.99]"
                style={{ background: P.gold, color: P.night }}
              >
                Share it (or screenshot the card)
              </button>
              <button onClick={() => setShareOpen(false)} className="mt-2 w-full py-2 text-xs font-bold" style={{ color: P.faint }}>Close</button>
            </div>
          </div>
        )}

        {/* Paywall — first reading free, then credits or unlimited */}
        {showPaywall && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(10,10,26,.85)" }} onClick={() => { setShowPaywall(false); setAuthStep(""); }}>
            <div className="w-full max-w-sm rounded-3xl p-6" style={{ background: P.nightSoft, border: "1px solid #2E3060" }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h2 className="smp-display text-2xl font-semibold" style={{ color: P.parchment }}>The tools await</h2>
                <button onClick={() => { setShowPaywall(false); setAuthStep(""); }}><X size={18} style={{ color: P.faint }} /></button>
              </div>
              {authStep === "attach" ? (
                <form onSubmit={attachEmail} className="mt-4 space-y-4">
                  <p className="text-sm" style={{ color: P.faint }}>Where should we keep your readings? Your free one comes with you.</p>
                  <Field label="Email" type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@example.com" />
                  <Field label="Password" type="password" required minLength={8} value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="At least 8 characters" />
                  {authError && <p className="text-sm" style={{ color: P.rose }}>{authError}</p>}
                  {authNote && <p className="text-sm" style={{ color: P.lavender }}>{authNote}</p>}
                  <button type="submit" disabled={authBusy} className="w-full rounded-xl py-3.5 font-bold text-sm transition-all active:scale-[.99] disabled:opacity-40" style={{ background: P.gold, color: P.night }}>
                    {authBusy ? "One moment…" : "Continue to checkout"}
                  </button>
                  <button type="button" onClick={() => setAuthStep("")} className="w-full py-1 text-xs font-bold" style={{ color: P.faint }}>Back</button>
                </form>
              ) : (
                <>
                  <p className="text-sm mt-1" style={{ color: P.faint }}>Your first reading was on the house. Choose how you continue:</p>
                  <div className="mt-4 space-y-2.5">
                    <button disabled={Boolean(checkoutBusy)} onClick={() => startCheckout("single")} className="w-full rounded-xl p-4 text-left border transition-all active:scale-[.99] disabled:opacity-40" style={{ borderColor: "#2E3060", background: P.night }}>
                      <p className="font-bold text-sm" style={{ color: P.parchment }}>One reading <span className="float-right" style={{ color: P.gold }}>$1.99</span></p>
                      <p className="text-xs mt-0.5" style={{ color: P.faint }}>For tonight's problem</p>
                    </button>
                    <button disabled={Boolean(checkoutBusy)} onClick={() => startCheckout("fivepack")} className="w-full rounded-xl p-4 text-left border transition-all active:scale-[.99] disabled:opacity-40" style={{ borderColor: P.gold, background: P.night }}>
                      <p className="font-bold text-sm" style={{ color: P.parchment }}>Five readings <span className="float-right" style={{ color: P.gold }}>$7.97</span></p>
                      <p className="text-xs mt-0.5" style={{ color: P.faint }}>Problems rarely travel alone · save 20%</p>
                    </button>
                    <button disabled={Boolean(checkoutBusy)} onClick={() => startCheckout("sub")} className="w-full rounded-xl p-4 text-left transition-all active:scale-[.99] disabled:opacity-40" style={{ background: P.goldSoft, border: `1px solid ${P.gold}` }}>
                      <p className="font-bold text-sm" style={{ color: P.gold }}>Unlimited + the Daily Card <span className="float-right">$4.99/mo</span></p>
                      <p className="text-xs mt-0.5" style={{ color: "#C9C7E3" }}>Every problem, plus one card every morning</p>
                    </button>
                  </div>
                  {checkoutError && <p className="text-sm mt-3" style={{ color: P.rose }}>{checkoutError}</p>}
                </>
              )}
            </div>
          </div>
        )}

        {/* Account — deliberately tiny: the first reading needs no login at all */}
        {isSupabaseConfigured && (
          <div className="mt-10 text-center">
            {authStep === "signin" ? (
              <form onSubmit={signIn} className="mx-auto w-full max-w-sm rounded-3xl p-5 space-y-4 text-left" style={{ background: P.nightSoft, border: "1px solid #2E3060" }}>
                <Field label="Email" type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@example.com" />
                <Field label="Password" type="password" required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Your password" />
                {authError && <p className="text-sm" style={{ color: P.rose }}>{authError}</p>}
                {authNote && <p className="text-sm" style={{ color: P.lavender }}>{authNote}</p>}
                <button type="submit" disabled={authBusy} className="w-full rounded-xl py-3 font-bold text-sm transition-all active:scale-[.99] disabled:opacity-40" style={{ background: P.gold, color: P.night }}>
                  {authBusy ? "One moment…" : "Sign in"}
                </button>
                <div className="flex items-center justify-between">
                  <button type="button" disabled={authBusy} onClick={forgotPassword} className="text-xs font-bold" style={{ color: P.faint }}>Forgot password</button>
                  <button type="button" onClick={() => { setAuthStep(""); setAuthError(""); setAuthNote(""); }} className="text-xs font-bold" style={{ color: P.faint }}>Close</button>
                </div>
              </form>
            ) : hasEmail ? (
              <p className="text-[11px]" style={{ color: P.faint }}>
                {user.email} · <button onClick={signOut} className="font-bold" style={{ color: P.faint }}>sign out</button>
              </p>
            ) : (
              <button onClick={() => { setAuthStep("signin"); setAuthError(""); setAuthNote(""); }} className="text-[11px] font-bold" style={{ color: P.faint }}>
                Been here before? Sign in
              </button>
            )}
          </div>
        )}

        <footer className="mt-14 text-center text-[10px] leading-relaxed" style={{ color: "#5B5C86" }}>
          solvingmyproblems.com · readings are for reflection & entertainment, not professional advice.<br />
          The practical steps are yours to keep either way.
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
DEV NOTES (Brayan) — production scope for the features above
- Share card: server-side render the reading card to a PNG (satori or
  puppeteer) + OG image per reading URL; client keeps navigator.share.
- Daily Card: subscriber-only cron -> one Claude call/user/day, delivered
  by email (Resend) + shown in-app. Cache per user per day.
- Compatibility mode: prompt handles it; store partner fields on reading.
- Payments: labs account. SKUs: single $1.99, five-pack $7.97 (credit
  ledger table), sub $4.99/mo. First reading requires NO login — create
  anonymous session, attach email only at purchase.
------------------------------------------------------------------- */

