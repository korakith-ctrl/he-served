alter table public.daily_logs add column if not exists workout_completed boolean not null default false;
alter table public.daily_logs add column if not exists rest_day boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workouts_profile_date_type_key') then
    alter table public.workouts add constraint workouts_profile_date_type_key unique(profile_id, date, workout_type);
  end if;
end $$;
