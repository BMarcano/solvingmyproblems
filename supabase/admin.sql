-- Owner dashboard for Solving My Problems — the same shape as The Good Hours'
-- admin panel: an admins allowlist, is_admin(), security-definer RPCs the
-- browser calls (each one checks is_admin() itself), and comped "unlimited
-- access" granted by email.
--
-- ⚠️ Run in the Solving My Problems project's SQL Editor. Idempotent.
-- Then run make-admin.sql once to add the owner.

-- ------------------------------------------------------------ admins ----
create table if not exists public.admins (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

-- security definer so it reads admins without recursing through RLS
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.admins where profile_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "admins_select_own" on public.admins;
create policy "admins_select_own" on public.admins
  for select to authenticated using (profile_id = auth.uid());
grant select on public.admins to authenticated;

-- --------------------------------------------------------- purchases ----
-- What Stripe actually charged (after promo codes), one row per Checkout
-- session, written by the webhook. credit_ledger stays the credit audit trail;
-- this is the money trail the dashboard sums.
create table if not exists public.purchases (
  stripe_session_id text primary key,
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  sku               text not null,                 -- single | fivepack | sub
  amount_cents      int  not null default 0,
  discount_cents    int  not null default 0,
  currency          text not null default 'usd',
  created_at        timestamptz not null default now()
);
alter table public.purchases enable row level security;
-- No client policies: server-written, read only through admin_users_list().
create index if not exists purchases_profile_idx on public.purchases (profile_id, created_at desc);

-- ------------------------------------------------- profile email sync ----
-- The paywall attaches an email to the auth user; mirror it onto the profile
-- so leads, comps and the dashboard all read one column.
create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.email <> '' then
    update public.profiles set email = lower(new.email)
     where id = new.id and (email is null or email = '');
  end if;
  return new;
end; $$;

drop trigger if exists on_auth_user_email on auth.users;
create trigger on_auth_user_email
  after update of email on auth.users for each row execute function public.sync_profile_email();

-- ------------------------------------------------------- comp access ----
-- "Unlimited access" by email, whether or not that person exists yet. A comped
-- subscription is a subscriptions row with status active and NO Stripe ids;
-- nothing here ever touches a real Stripe subscription.
create table if not exists public.comp_access (
  email      text primary key,           -- always lowercased (norm_email)
  note       text,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.comp_access enable row level security;
revoke all on public.comp_access from anon;
revoke all on public.comp_access from authenticated;

create or replace function public.norm_email(p text)
returns text language sql immutable as $$
  select lower(btrim(coalesce(p, '')));
$$;

create or replace function public.apply_comp(p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_stripe text;
begin
  select stripe_subscription_id into v_stripe from public.subscriptions where profile_id = p_user;
  if v_stripe is not null then
    return false; -- already a real subscriber; leave Stripe's row alone
  end if;
  insert into public.subscriptions (profile_id, status, current_period_end, updated_at)
  values (p_user, 'active', null, now())
  on conflict (profile_id) do update
    set status = 'active', current_period_end = null, updated_at = now()
    where public.subscriptions.stripe_subscription_id is null;
  return true;
end; $$;
revoke all on function public.apply_comp(uuid) from public;

-- The email lands on the profile (free reading capture, paywall, webhook):
-- if it was comped in advance, switch it on right then.
create or replace function public.profiles_apply_comp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null
     and exists (select 1 from public.comp_access c where c.email = public.norm_email(new.email)) then
    perform public.apply_comp(new.id);
  end if;
  return new;
end; $$;

drop trigger if exists on_profile_email_comp on public.profiles;
create trigger on_profile_email_comp
  after insert or update of email on public.profiles for each row execute function public.profiles_apply_comp();

create or replace function public.admin_grant_access(p_email text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := public.norm_email(p_email);
  v_user  uuid;
  v_ok    boolean;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'invalid email'; end if;

  insert into public.comp_access (email, note, granted_by)
  values (v_email, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (email) do update
    set note = coalesce(excluded.note, comp_access.note), granted_by = excluded.granted_by;

  select id into v_user from public.profiles where public.norm_email(email) = v_email limit 1;
  if v_user is null then
    select id into v_user from auth.users where lower(email) = v_email limit 1;
  end if;
  if v_user is null then
    return jsonb_build_object('registered', false, 'applied', false, 'email', v_email);
  end if;

  v_ok := public.apply_comp(v_user);
  return jsonb_build_object('registered', true, 'applied', v_ok, 'already_paying', not v_ok, 'email', v_email);
end; $$;
revoke execute on function public.admin_grant_access(text, text) from public;
grant execute on function public.admin_grant_access(text, text) to authenticated;

create or replace function public.admin_revoke_access(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := public.norm_email(p_email);
  v_user  uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.comp_access where email = v_email;
  select id into v_user from public.profiles where public.norm_email(email) = v_email limit 1;
  if v_user is null then
    select id into v_user from auth.users where lower(email) = v_email limit 1;
  end if;
  if v_user is not null then
    -- only ever the comped row; a Stripe subscription is untouched
    update public.subscriptions set status = 'canceled', updated_at = now()
     where profile_id = v_user and stripe_subscription_id is null;
  end if;
end; $$;
revoke execute on function public.admin_revoke_access(text) from public;
grant execute on function public.admin_revoke_access(text) to authenticated;

create or replace function public.admin_comp_list()
returns table (email text, note text, created_at timestamptz, active boolean)
language sql security definer set search_path = public stable as $$
  select c.email, c.note, c.created_at,
         exists (
           select 1 from public.profiles p
           join public.subscriptions s on s.profile_id = p.id
           where public.norm_email(p.email) = c.email
             and s.status = 'active' and s.stripe_subscription_id is null
         ) as active
  from public.comp_access c
  where public.is_admin()
  order by c.created_at desc;
$$;
revoke execute on function public.admin_comp_list() from public;
grant execute on function public.admin_comp_list() to authenticated;

-- ------------------------------------------------------ the user list ----
-- Everyone who did something: left an email, took a reading, or paid. Pure
-- anonymous visits that never consulted are left out (ad traffic creates a
-- lot of those). One row per account with everything the dashboard shows,
-- including the lifecycle-email trail, so "did they get the emails?" is a
-- glance, not a query.
create or replace function public.admin_users_list()
returns table (
  id             uuid,
  email          text,
  created_at     timestamptz,
  is_anonymous   boolean,
  free_used      boolean,
  credits        int,
  readings_count bigint,
  last_reading   timestamptz,
  sub_status     text,
  is_unlimited   boolean,
  is_comped      boolean,
  is_paying      boolean,
  spent_cents    bigint,
  email_opt_out  boolean,
  emails         jsonb
) language sql security definer set search_path = public stable as $$
  select p.id,
         coalesce(p.email, u.email::text)                                   as email,
         u.created_at,
         coalesce(u.is_anonymous, false)                                    as is_anonymous,
         p.free_readings_used > 0                                           as free_used,
         p.credits,
         (select count(*) from public.readings r where r.profile_id = p.id) as readings_count,
         (select max(r.created_at) from public.readings r where r.profile_id = p.id) as last_reading,
         s.status                                                           as sub_status,
         coalesce(s.status in ('active', 'trialing')
                  and (s.current_period_end is null or s.current_period_end > now()), false) as is_unlimited,
         coalesce(s.status = 'active' and s.stripe_subscription_id is null, false)          as is_comped,
         (exists (select 1 from public.purchases x where x.profile_id = p.id)
          or exists (select 1 from public.credit_ledger l where l.profile_id = p.id and l.reason like 'purchase_%')
          or (s.stripe_subscription_id is not null and s.status in ('active', 'trialing')))   as is_paying,
         coalesce((select sum(x.amount_cents) from public.purchases x where x.profile_id = p.id), 0) as spent_cents,
         coalesce(p.email_opt_out, false)                                   as email_opt_out,
         coalesce((
           select jsonb_agg(jsonb_build_object('kind', e.kind, 'status', e.status, 'send_at', e.send_at, 'sent_at', e.sent_at)
                            order by e.send_at)
           from public.email_jobs e where e.profile_id = p.id
         ), '[]'::jsonb)                                                    as emails
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.subscriptions s on s.profile_id = p.id
  where public.is_admin()
    and (p.email is not null or u.email is not null or p.free_readings_used > 0 or p.credits > 0
         or exists (select 1 from public.readings r where r.profile_id = p.id))
  order by u.created_at desc
  limit 2000;
$$;
revoke execute on function public.admin_users_list() from public;
grant execute on function public.admin_users_list() to authenticated;
