# Solving My Problems

A tasteful, fun divination app ([solvingmyproblems.com](https://solvingmyproblems.com)).
Type a real problem, add optional birth details, and one Claude call returns five
readings — tarot, I Ching, numerology, astrology, and the 8-ball — plus a
practical synthesis. Entertainment product, with a serious conversion design: the
**first reading is free with no login**, then credits or a subscription.

> Readings are for reflection and entertainment, not professional advice.

## Stack

- **Vite + React + Tailwind v3 + lucide-react** (the "Midnight Parlor" theme),
  deployed on **Vercel**.
- **Serverless `/api` functions** for the Anthropic call and (later) Stripe.
- **Supabase** (auth + Postgres + RLS) — wired up in T2.

## Local development

```bash
npm install
npm run dev        # UI only (Vite dev server) — /api is not served here
```

To exercise the `/api` functions locally (so `Consult the tools` actually
returns a reading), use the Vercel CLI, which runs the serverless functions:

```bash
npm i -g vercel
vercel dev
```

Create a `.env.local` from `.env.example` and set at least `ANTHROPIC_API_KEY`.

```bash
npm run build      # production build -> dist/ (must stay green)
```

## Environment variables

See [`.env.example`](./.env.example). For the T1 demo the only required server
variable is `ANTHROPIC_API_KEY`. Server secrets must **never** carry the `VITE_`
prefix — that would ship them to the browser.

## Deploy (Vercel)

Zero-config: Vercel detects Vite (build → `dist/`) and serves everything under
`/api` as Node serverless functions. Set the environment variables in the
Vercel dashboard, then deploy. `success_url` / `cancel_url` and the paywall go
live with Stripe in T3.

## Architecture notes

- **The Anthropic call never runs in the browser.** The reading prompt (with its
  safety guardrails) and every reading-consumption decision live in
  [`api/consult.js`](./api/consult.js).
- **Gating is server-side, behind `GATING_ENABLED`.** T1 stubs it to "allow" so
  the demo works with no login; T2 turns it on (active subscription → allow;
  else a credit is spent; else the free reading is used; else `402`).
- **Client-approved design is fixed** — no visual, copy, or layout changes.

## Milestones

- **T1 — done:** scaffold + approved UI, `/api/consult` (Anthropic + prompt) with
  gating stubbed to allow. Live demo on day one.
- **T2:** Supabase schema, anonymous sessions on boot, JWT verification + the
  full gate in `consult`, readings stored, profile state in the UI.
- **T3:** Stripe products/prices, checkout endpoint, webhook fulfillment,
  anonymous → email conversion, paywall wired to real money.
- **T4:** Daily Card endpoint + subscriber gate.
- **T5:** Launch — domain, Supabase Site URL/redirects, password-reset SMTP,
  full test matrix.
