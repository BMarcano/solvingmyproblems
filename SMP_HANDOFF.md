# Solving My Problems — Engineering Handoff (for Claude Code)

You are building **Solving My Problems** (solvingmyproblems.com): a tasteful,
fun divination app. A person types a real problem plus optional birth details,
and one Claude call returns five readings (tarot, I Ching, numerology,
astrology, 8-ball) plus a practical synthesis. Entertainment product with a
serious conversion design: the FIRST reading is free with NO login, then money.

Monetization:
- Single reading: $1.99 (one-time, 1 credit)
- Five-pack: $7.97 (one-time, 5 credits)
- Unlimited + Daily Card: $4.99/mo subscription

The complete UI is already designed and client-approved (single React file,
Tailwind classes + lucide-react icons, "Midnight Parlor" theme). **Do not
change the look, copy, animations, or layout.** The build is making it real.

Reference builds: this reuses the exact machine from The Good Hours (Vite +
React + Tailwind v3 + lucide-react on Vercel, Supabase auth + Postgres + RLS,
serverless /api functions for Anthropic calls and Stripe).

## 0. Architecture decisions (read before coding)

1. **Anonymous-first auth.** On first visit with no session, silently call
   `supabase.auth.signInAnonymously()`. Anonymous users are real auth.users
   rows, so the profiles trigger, RLS, and the free-reading counter all work
   identically to a normal user. When they buy, the SAME account converts to a
   permanent one via `supabase.auth.updateUser({ email, password })` — the
   user id, credits, and history carry over.
2. **Every reading-consumption decision happens SERVER-SIDE.** The entire
   business is per-reading; client-side gating would mean free unlimited
   readings for anyone with devtools. `/api/consult` verifies the Supabase JWT
   and decides: active subscription → allow; else credits > 0 → atomic spend;
   else free_readings_used = 0 → allow and increment; else HTTP 402 → client
   opens the paywall.
3. **Credits are money.** Balance lives in `profiles.credits`, every change is
   also written to `credit_ledger` (audit), spending happens ONLY through the
   `spend_credit()` security-definer function (atomic, can't go negative), and
   adding happens ONLY from the Stripe webhook with the service-role key.
4. Known accepted tradeoff for v1: a determined person can clear cookies to
   get another anonymous free reading. Fine — the paid surface (credits and
   subscriptions) is fully server-enforced.
5. The reading prompt contains safety guardrails (never predict death,
   illness, disaster, or legal/financial outcomes; frame as reflection; end
   useful). **Preserve them verbatim.** Keep the "for reflection &
   entertainment" copy in the UI exactly as designed.

## 1. Repo layout (create in T1)

```
/
├── api/
│   ├── consult.js                # the reading engine (Anthropic, gated)
│   ├── daily-card.js             # subscriber daily pull, cached per day
│   ├── create-checkout-session.js
│   └── stripe-webhook.js
├── index.html                    # title: Solving My Problems
├── package.json                  # react, react-dom, @supabase/supabase-js,
│                                 # lucide-react, stripe (server dep);
│                                 # dev: vite, @vitejs/plugin-react,
│                                 # tailwindcss v3, postcss, autoprefixer
├── tailwind.config.js / postcss.config.js / vite.config.js
└── src/
    ├── main.jsx  ·  index.css (@tailwind directives)
    ├── supabaseClient.js         # from VITE_SUPABASE_URL / _ANON_KEY
    └── App.jsx                   # the full approved mockup, wired up
```

## 2. Environment variables

Client (Vercel + local .env): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Server-only (Vercel, NEVER with VITE_ prefix): `ANTHROPIC_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_SINGLE`, `STRIPE_PRICE_FIVEPACK`, `STRIPE_PRICE_SUB`.

## 3. Database schema (run in the SMP Supabase project's SQL Editor)

⚠️ Verify you are in the Solving My Problems project (the client now has
several Supabase projects). Idempotent, safe to re-run.

```sql
-- profiles: one row per user (anonymous users included, via trigger)
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  display_name       text,
  free_readings_used int not null default 0,
  credits            int not null default 0,
  created_at         timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);
-- No client update policy: free counter and credits are server-managed.
grant select on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- readings: every generated reading (history + future share pages)
create table if not exists public.readings (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references public.profiles (id) on delete cascade,
  problem          text,
  mode             text not null default 'solo',   -- 'solo' | 'duo'
  partner_name     text,
  partner_birthdate date,
  birthdate        date,
  result           jsonb not null,
  created_at       timestamptz not null default now()
);
alter table public.readings enable row level security;

drop policy if exists "readings_select_own" on public.readings;
create policy "readings_select_own" on public.readings
  for select to authenticated using (auth.uid() = profile_id);
-- Inserts come from the server (service role). No client write policies.
grant select on public.readings to authenticated;
create index if not exists readings_profile_idx on public.readings (profile_id, created_at desc);

-- daily_cards: one cached card per subscriber per day
create table if not exists public.daily_cards (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  day        date not null,
  card       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, day)
);
alter table public.daily_cards enable row level security;

drop policy if exists "daily_cards_select_own" on public.daily_cards;
create policy "daily_cards_select_own" on public.daily_cards
  for select to authenticated using (auth.uid() = profile_id);
grant select on public.daily_cards to authenticated;

-- subscriptions: written ONLY by the Stripe webhook (service role)
create table if not exists public.subscriptions (
  profile_id             uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 text,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);
alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select to authenticated using (auth.uid() = profile_id);
grant select on public.subscriptions to authenticated;

-- credit_ledger: audit trail; balance lives on profiles.credits
create table if not exists public.credit_ledger (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  delta      int not null,
  reason     text not null,           -- 'purchase_single' | 'purchase_fivepack' | 'spend_reading'
  stripe_ref text,
  created_at timestamptz not null default now()
);
alter table public.credit_ledger enable row level security;

drop policy if exists "ledger_select_own" on public.credit_ledger;
create policy "ledger_select_own" on public.credit_ledger
  for select to authenticated using (auth.uid() = profile_id);
grant select on public.credit_ledger to authenticated;

-- Atomic credit spend: returns true if a credit was consumed
create or replace function public.spend_credit(p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare updated int;
begin
  update public.profiles set credits = credits - 1
   where id = p_user and credits > 0;
  get diagnostics updated = row_count;
  if updated = 1 then
    insert into public.credit_ledger (profile_id, delta, reason)
    values (p_user, -1, 'spend_reading');
    return true;
  end if;
  return false;
end; $$;
revoke all on function public.spend_credit(uuid) from public;
-- Called only from the server with the service role; no grant to authenticated.

-- Server-side helper to consume the free reading atomically
create or replace function public.use_free_reading(p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare updated int;
begin
  update public.profiles set free_readings_used = free_readings_used + 1
   where id = p_user and free_readings_used = 0;
  get diagnostics updated = row_count;
  return updated = 1;
end; $$;
revoke all on function public.use_free_reading(uuid) from public;
```

## 4. API endpoints (Vercel serverless, Node)

All authenticated endpoints receive `Authorization: Bearer <supabase access
token>`; verify with a service-role admin client (`supabase.auth.getUser(token)`).

### /api/consult.js — the reading engine
1. POST { problem, birthdate, birthtime, birthplace, partnerName,
   partnerBirthdate, mode }. Validate: problem required, non-trivial length cap
   (e.g. 600 chars).
2. Verify JWT → user id. Load subscription status.
3. Gate, in order: active subscription → allowed; else
   `spend_credit(user)` true → allowed; else `use_free_reading(user)` true →
   allowed; else respond `402 { error: "payment_required" }`.
4. Call Anthropic (model `claude-sonnet-4-6`, max_tokens 1000, headers
   x-api-key: ANTHROPIC_API_KEY + anthropic-version: 2023-06-01) with the
   EXACT prompt from the mockup's `consultTheTools`, including the
   compatibility-mode block and all safety guardrails, verbatim.
5. Parse (strip ```json fences), on parse failure retry once, then 502.
   IMPORTANT on failure AFTER a credit was spent: refund via a +1 ledger
   insert and credits increment (service role) so users never pay for errors.
6. Insert the reading row (service role) and return the JSON to the client.

### /api/daily-card.js
POST { day } (client's local YYYY-MM-DD). Verify JWT → require ACTIVE
subscription (403 otherwise). If daily_cards has (user, day) return it;
otherwise call Anthropic with the mockup's `pullDailyCard` prompt verbatim
(max_tokens 400), store, return.

### /api/create-checkout-session.js
POST { sku } where sku ∈ single | fivepack | sub. Verify JWT. Reject
anonymous users (`user.is_anonymous`) with 409 { error: "attach_email" } —
the client converts the account first (see T3). Find-or-create the Stripe
customer (store id on subscriptions row or customer metadata supabase_uid).
mode: 'payment' for single/fivepack, 'subscription' for sub, using the
STRIPE_PRICE_* env ids. Set metadata { supabase_uid, sku } on the session.
success_url `${origin}/?checkout=success`, cancel_url `${origin}/?checkout=cancel`.
Return { url }.

### /api/stripe-webhook.js
Verify signature with STRIPE_WEBHOOK_SECRET (raw body!). Handle:
- checkout.session.completed: read metadata.supabase_uid + sku. For single →
  +1 credit, fivepack → +5 (update profiles.credits AND insert ledger row,
  service role, idempotent on session id via stripe_ref). For sub → upsert
  subscriptions (status active, ids, period end).
- customer.subscription.updated / deleted: update status +
  current_period_end by stripe_subscription_id.
Respond 200 quickly; log everything.

## 5. Front-end wiring (App.jsx changes only — visuals untouched)

- Boot: get session; if none, `signInAnonymously()`. Keep a `profile` +
  `subscription` + `credits` state loaded from the tables (select own rows).
- `consultTheTools` / `pullDailyCard`: replace direct Anthropic fetches with
  calls to `/api/consult` and `/api/daily-card`, sending the access token in
  the Authorization header.
- On 402 from consult: open the existing paywall modal. The local
  `readingsUsed/credits/subscribed` mock states get replaced by the loaded
  real values (refresh profile after each reading and after checkout returns).
- Paywall buttons: call create-checkout-session and redirect to the returned
  url. On 409 attach_email: show a minimal email + password step (matching
  the app's Field styling) that calls
  `supabase.auth.updateUser({ email, password })` to convert the anonymous
  account, then retries checkout. On `?checkout=success` re-fetch profile +
  subscription and show the existing success states.
- Daily Card section: gate on real subscription; pull via the endpoint.
- Add a tiny, unobtrusive `sign out` (P.faint style) for converted accounts,
  plus sign-in for returning users (email + password; "forgot password" via
  `resetPasswordForEmail` — reuse the Good Hours recovery pattern).

## 6. Work queue

- **T1** Scaffold + UI: Vite/Tailwind/lucide project, mockup App.jsx dropped
  in as-is, `/api/consult` implemented (Anthropic + prompt) with gating
  stubbed to "allow" behind a `GATING_ENABLED` flag, deploy to Vercel. Goal:
  live demo on day one.
- **T2** Supabase: run schema, anonymous sessions on boot, JWT verification
  and the full gate in consult (flag on), readings stored, profile state in UI.
- **T3** Stripe: products/prices, checkout endpoint, webhook fulfillment,
  anonymous→email conversion step, paywall wired to real money, credits shown
  from DB. Test with Stripe test mode + `stripe listen` or the dashboard's
  webhook tester before going live.
- **T4** Daily Card endpoint + subscriber gate.
- **T5** Launch: domain solvingmyproblems.com (apex A record → owner adds
  DNS), Supabase Site URL/redirects, SMTP for password-reset emails (same
  Gmail app-password pattern as the other apps, under the owner's account),
  full test matrix: anonymous free reading → 402 → buy single (test card) →
  reading spends credit → refund-on-error path → five-pack → subscribe →
  unlimited + daily card → sign out/in persistence → second account isolation.
- **NOT in this milestone** (future, already sold as such): daily card by
  email (cron + Resend), server-rendered share images / per-reading OG pages,
  reading history UI. The share modal + navigator.share ships as designed.

## 7. Hard rules

1. Client-approved design: no visual, copy, or layout changes.
2. All secrets server-side only. The Anthropic call never runs in the browser.
3. Reading consumption is decided exclusively in /api/consult. Credits and
   subscriptions are written exclusively by the webhook / security-definer
   functions. No client write policies on money tables.
4. Preserve the prompt guardrails and the entertainment disclaimer verbatim.
5. Stripe webhook must be idempotent (dedupe on event/session id via
   credit_ledger.stripe_ref) and verify signatures on the raw body.
6. RLS on every table before it holds data. `npm run build` green + the T5
   test matrix passing before calling any task done.
