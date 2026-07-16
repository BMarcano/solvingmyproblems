import { useState } from "react";
import { Sparkles, Moon, Hash, Compass, CircleDot, ScrollText, RefreshCw, Share2, Heart, X, Lock, Sun } from "lucide-react";

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
    .smp-root { font-family: 'Karla', sans-serif; }
    .smp-display { font-family: 'Cormorant Garamond', serif; }
    .smp-mono { font-family: 'Space Mono', monospace; }
    @keyframes dealIn { from { opacity: 0; transform: translateY(24px) rotate(var(--tilt, 0deg)) scale(.96); } to { opacity: 1; transform: translateY(0) rotate(var(--tilt, 0deg)) scale(1); } }
    .deal { animation: dealIn .7s cubic-bezier(.2,.8,.2,1) both; }
    @keyframes twinkle { 0%,100% { opacity: .25; } 50% { opacity: .9; } }
    .star { animation: twinkle var(--tw, 3s) ease-in-out infinite; }
    @keyframes floaty { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    .floaty { animation: floaty 4s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) { .deal, .star, .floaty { animation: none; } }
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

// Deterministic star field (no re-randomizing on render)
const STARS = Array.from({ length: 40 }, (_, i) => ({
  left: ((i * 37) % 100),
  top: ((i * 53) % 100),
  size: (i % 3) + 1,
  tw: 2.2 + (i % 5) * 0.7,
}));

async function consultTheTools({ problem, birthdate, birthtime, birthplace, partnerName, partnerBirthdate }) {
  // The reading engine (the Anthropic call plus the prompt and its safety
  // guardrails) runs server-side in /api/consult, so the API key never reaches
  // the browser and every reading-consumption decision stays on the server.
  const response = await fetch("/api/consult", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  if (!response.ok) throw new Error(`consult failed (${response.status})`);
  return response.json();
}

// ---------- Daily Card: subscriber ritual — one-card morning pull ----------
async function pullDailyCard({ birthdate }) {
  // Subscriber daily pull, generated and cached per day server-side in
  // /api/daily-card (wired up in a later milestone; gated on an active sub).
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const response = await fetch("/api/daily-card", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ day }),
  });
  if (!response.ok) throw new Error(`daily-card failed (${response.status})`);
  return response.json();
}

function Label({ children }) {
  return <p className="smp-mono text-[10px] tracking-[.25em] uppercase mb-2" style={{ color: P.gold }}>{children}</p>;
}

function Field({ label, ...props }) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        {...props}
        className="w-full rounded-lg px-4 py-3 text-sm outline-none border transition-colors focus:border-current"
        style={{ background: P.nightSoft, borderColor: "#2E3060", color: P.parchment }}
      />
    </div>
  );
}

function ToolCard({ icon: Icon, tool, title, tilt, delay, children }) {
  return (
    <div
      className="deal rounded-2xl p-5 relative"
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

  async function handleConsult() {
    // First reading free (no login). After that: a credit or the subscription.
    if (readingsUsed >= 1 && !subscribed) {
      if (credits <= 0) { setShowPaywall(true); return; }
      setCredits((c) => c - 1);
    }
    setLoading(true);
    setError("");
    try {
      const r = await consultTheTools({
        problem, birthdate, birthtime, birthplace,
        partnerName: mode === "duo" ? partnerName : "",
        partnerBirthdate: mode === "duo" ? partnerBirthdate : "",
      });
      setReading(r);
      setReadingsUsed((n) => n + 1);
    } catch (e) {
      setError("The tools are being temperamental. Give it another try in a moment.");
    }
    setLoading(false);
  }

  return (
    <div className="smp-root min-h-screen w-full relative overflow-hidden" style={{ background: P.night }}>
      {FONTS}
      {/* star field */}
      <div className="absolute inset-0 pointer-events-none">
        {STARS.map((s, i) => (
          <div key={i} className="star absolute rounded-full" style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, background: P.gold, "--tw": `${s.tw}s` }} />
        ))}
      </div>

      <div className="relative max-w-2xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="text-center">
          <div className="floaty inline-block"><Moon size={28} style={{ color: P.gold }} /></div>
          <h1 className="smp-display text-5xl font-semibold mt-3" style={{ color: P.parchment }}>
            Solving <em style={{ color: P.gold }}>My</em> Problems
          </h1>
          <p className="text-sm mt-3 max-w-md mx-auto leading-relaxed" style={{ color: P.faint }}>
            Bring the tools of five ancient advisors to one modern problem. Tarot, the I Ching, numerology, the stars — and, for tie-breaks, the 8-ball.
          </p>
        </header>

        {/* Input */}
        {!reading && (
          <section className="mt-10 rounded-3xl p-6 space-y-5" style={{ background: P.nightSoft, border: "1px solid #2E3060" }}>
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
              className="w-full rounded-xl py-4 font-bold text-sm tracking-wide transition-all active:scale-[.99] disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: P.gold, color: P.night }}
            >
              <Sparkles size={16} />
              {loading ? "Consulting the tools…" : "Consult the tools"}
            </button>
            <p className="text-center text-[11px]" style={{ color: P.faint }}>
              For reflection and entertainment — the practical steps, though, are real.
            </p>
          </section>
        )}

        {/* Daily Card — the subscriber ritual */}
        {!reading && (
          <section className="mt-6 rounded-3xl p-5" style={{ background: P.nightSoft, border: "1px solid #2E3060" }}>
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
                  onClick={async () => { setDailyLoading(true); try { setDaily(await pullDailyCard({ birthdate })); } catch {} setDailyLoading(false); }}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(10,10,26,.85)" }} onClick={() => setShowPaywall(false)}>
            <div className="w-full max-w-sm rounded-3xl p-6" style={{ background: P.nightSoft, border: "1px solid #2E3060" }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h2 className="smp-display text-2xl font-semibold" style={{ color: P.parchment }}>The tools await</h2>
                <button onClick={() => setShowPaywall(false)}><X size={18} style={{ color: P.faint }} /></button>
              </div>
              <p className="text-sm mt-1" style={{ color: P.faint }}>Your first reading was on the house. Choose how you continue:</p>
              <div className="mt-4 space-y-2.5">
                <button onClick={() => { setCredits((c) => c + 1); setShowPaywall(false); }} className="w-full rounded-xl p-4 text-left border transition-all active:scale-[.99]" style={{ borderColor: "#2E3060", background: P.night }}>
                  <p className="font-bold text-sm" style={{ color: P.parchment }}>One reading <span className="float-right" style={{ color: P.gold }}>$1.99</span></p>
                  <p className="text-xs mt-0.5" style={{ color: P.faint }}>For tonight's problem</p>
                </button>
                <button onClick={() => { setCredits((c) => c + 5); setShowPaywall(false); }} className="w-full rounded-xl p-4 text-left border transition-all active:scale-[.99]" style={{ borderColor: P.gold, background: P.night }}>
                  <p className="font-bold text-sm" style={{ color: P.parchment }}>Five readings <span className="float-right" style={{ color: P.gold }}>$7.97</span></p>
                  <p className="text-xs mt-0.5" style={{ color: P.faint }}>Problems rarely travel alone · save 20%</p>
                </button>
                <button onClick={() => { setSubscribed(true); setShowPaywall(false); }} className="w-full rounded-xl p-4 text-left transition-all active:scale-[.99]" style={{ background: P.goldSoft, border: `1px solid ${P.gold}` }}>
                  <p className="font-bold text-sm" style={{ color: P.gold }}>Unlimited + the Daily Card <span className="float-right">$4.99/mo</span></p>
                  <p className="text-xs mt-0.5" style={{ color: "#C9C7E3" }}>Every problem, plus one card every morning</p>
                </button>
              </div>
              <p className="text-[10px] text-center mt-3" style={{ color: P.faint }}>Demo buttons — production wires these to Stripe/Lemon Squeezy checkout.</p>
            </div>
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

