-- Make someone an admin so they get the owner dashboard inside the app.
-- Run AFTER supabase/admin.sql, and after that person has signed in to
-- Solving My Problems with email + password at least once (the anonymous
-- free-reading session doesn't count — the dashboard needs a real login).
-- Replace the email.
insert into public.admins (profile_id)
select id from auth.users where lower(email) = lower('ashley@naset.org')
on conflict (profile_id) do nothing;
