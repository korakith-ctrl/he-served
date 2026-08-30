-- Standalone Recomp app schema. Demo mode uses localStorage; production can connect this schema.
create extension if not exists "pgcrypto";

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null default '2026-08-30',
  duration_weeks integer not null default 16 check (duration_weeks > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  avatar_url text,
  start_date date not null default '2026-08-30',
  start_weight numeric(5,2) not null,
  goal_weight_min numeric(5,2) not null,
  goal_weight_max numeric(5,2) not null,
  stretch_goal numeric(5,2),
  calorie_target integer not null,
  protein_target_min integer not null,
  protein_target_max integer not null,
  water_target numeric(3,1) not null,
  created_at timestamptz not null default now(),
  unique(user_id)
);

create table if not exists public.challenge_members (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  primary key(challenge_id, profile_id)
);

create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  weight numeric(5,2), calories integer, protein numeric(6,1), carbs numeric(6,1), fat numeric(6,1),
  water numeric(4,1), steps integer, sleep_minutes integer, waist numeric(5,1), body_fat numeric(4,1),
  muscle_mass numeric(5,2), visceral_fat numeric(4,1), mood text, hunger smallint check(hunger between 1 and 5),
  energy smallint check(energy between 1 and 5), notes text, sick_day boolean not null default false,
  vacation_mode boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(profile_id,date)
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  date date not null, workout_type text not null check(workout_type in ('A','B','custom')),
  duration integer, notes text, created_at timestamptz not null default now()
);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(), workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise text not null, set_number smallint not null, weight numeric(6,2), reps smallint, rir smallint check(rir between 0 and 10)
);

create table if not exists public.weekly_reviews (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  week_number smallint not null check(week_number between 1 and 16), avg_weight numeric(5,2), weekly_change numeric(5,2),
  avg_calories integer, avg_steps integer, protein_compliance numeric(5,2), workout_compliance numeric(5,2),
  avg_sleep integer, waist numeric(5,1), summary text, created_at timestamptz not null default now(), unique(profile_id,week_number)
);

create table if not exists public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  morning_weigh_in boolean not null default false,
  protein_reminder boolean not null default false,
  workout_reminder boolean not null default false,
  weekly_review boolean not null default true,
  quiet_hours_start time not null default '21:00',
  quiet_hours_end time not null default '08:00',
  updated_at timestamptz not null default now()
);

alter table public.challenges enable row level security;
alter table public.profiles enable row level security;
alter table public.challenge_members enable row level security;
alter table public.daily_logs enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_sets enable row level security;
alter table public.weekly_reviews enable row level security;
alter table public.notification_preferences enable row level security;

create or replace function public.can_view_profile(target_profile uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles p where p.id=target_profile and p.user_id=auth.uid())
  or exists(
    select 1 from challenge_members mine join profiles me on me.id=mine.profile_id
    join challenge_members shared on shared.challenge_id=mine.challenge_id
    where me.user_id=auth.uid() and shared.profile_id=target_profile
  );
$$;

create policy "profiles visible to owner or challenge" on public.profiles for select using(public.can_view_profile(id));
create policy "profiles editable by owner" on public.profiles for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "logs visible to challenge" on public.daily_logs for select using(public.can_view_profile(profile_id));
create policy "logs editable by owner" on public.daily_logs for all using(exists(select 1 from profiles p where p.id=profile_id and p.user_id=auth.uid())) with check(exists(select 1 from profiles p where p.id=profile_id and p.user_id=auth.uid()));
create policy "workouts visible to challenge" on public.workouts for select using(public.can_view_profile(profile_id));
create policy "workouts editable by owner" on public.workouts for all using(exists(select 1 from profiles p where p.id=profile_id and p.user_id=auth.uid())) with check(exists(select 1 from profiles p where p.id=profile_id and p.user_id=auth.uid()));
create policy "sets visible through workout" on public.workout_sets for select using(exists(select 1 from workouts w where w.id=workout_id and public.can_view_profile(w.profile_id)));
create policy "sets editable by owner" on public.workout_sets for all using(exists(select 1 from workouts w join profiles p on p.id=w.profile_id where w.id=workout_id and p.user_id=auth.uid())) with check(exists(select 1 from workouts w join profiles p on p.id=w.profile_id where w.id=workout_id and p.user_id=auth.uid()));
create policy "reviews visible to challenge" on public.weekly_reviews for select using(public.can_view_profile(profile_id));
create policy "reviews editable by owner" on public.weekly_reviews for all using(exists(select 1 from profiles p where p.id=profile_id and p.user_id=auth.uid())) with check(exists(select 1 from profiles p where p.id=profile_id and p.user_id=auth.uid()));
create policy "members visible to same challenge" on public.challenge_members for select using(public.can_view_profile(profile_id));
create policy "challenges visible to members" on public.challenges for select using(exists(select 1 from challenge_members cm join profiles p on p.id=cm.profile_id where cm.challenge_id=id and p.user_id=auth.uid()));
create policy "authenticated users create challenges" on public.challenges for insert with check(auth.uid() is not null);
create policy "owners add challenge membership" on public.challenge_members for insert with check(exists(select 1 from profiles p where p.id=profile_id and p.user_id=auth.uid()));
create policy "preferences owned by profile owner" on public.notification_preferences for all using(exists(select 1 from profiles p where p.id=profile_id and p.user_id=auth.uid())) with check(exists(select 1 from profiles p where p.id=profile_id and p.user_id=auth.uid()));
