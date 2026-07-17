-- Solving My Problems — database schema
--
-- ⚠️  Run this in the SQL Editor of the *Solving My Problems* Supabase project.
--     Double-check the project before running: several other projects exist, and
--     the drop policy / drop trigger statements below use generic names
--     (on_auth_user_created, profiles_select_own, handle_new_user) that other
--     products very likely also use. Running this in the wrong project would
--     drop their trigger and policies.
--
-- Idempotent: safe to re-run.

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

-- ---------------------------------------------------------------------------
-- Credit granting (purchases + error refunds).
--
-- Added on top of the handoff schema so that hard rules #3 and #5 hold under
-- concurrency: credits are only ever written by a security-definer function,
-- and Stripe fulfilment is idempotent at the DATABASE level rather than by a
-- read-then-write in the webhook (Stripe retries deliver the same event twice,
-- and two concurrent retries would otherwise both credit the account).
-- ---------------------------------------------------------------------------

-- One ledger row per Stripe reference. This is what makes fulfilment idempotent.
-- Partial index: refunds and spends pass a null stripe_ref and are unconstrained.
create unique index if not exists credit_ledger_stripe_ref_key
  on public.credit_ledger (stripe_ref) where stripe_ref is not null;

-- Atomic credit grant. Returns true when credits were added, false when this
-- p_stripe_ref was already applied (duplicate webhook delivery -> no-op).
create or replace function public.grant_credits(
  p_user       uuid,
  p_delta      int,
  p_reason     text,
  p_stripe_ref text default null
)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_delta <= 0 then
    raise exception 'grant_credits: p_delta must be positive (got %)', p_delta;
  end if;

  insert into public.credit_ledger (profile_id, delta, reason, stripe_ref)
  values (p_user, p_delta, p_reason, p_stripe_ref);

  update public.profiles set credits = credits + p_delta where id = p_user;
  return true;
exception
  when unique_violation then
    -- credit_ledger_stripe_ref_key tripped: this purchase is already fulfilled.
    return false;
end; $$;
revoke all on function public.grant_credits(uuid, int, text, text) from public;
