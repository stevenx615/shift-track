create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  employer text,
  type text,
  rate numeric not null default 0,
  pay_type text not null default 'Hourly',
  color text not null default '#2563eb',
  bg text not null default '#dbeafe',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id text not null references public.jobs(id) on delete cascade,
  title text,
  date date not null,
  start_time time,
  end_time time,
  break_mins integer not null default 0,
  paid_break integer not null default 0,
  notes text,
  status text not null default 'Recorded',
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shift_templates (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  job_id text not null references public.jobs(id) on delete cascade,
  title text,
  start_time time,
  end_time time,
  break_mins integer not null default 0,
  paid_break integer not null default 0,
  location text,
  notes text,
  tags text[] not null default '{}',
  display_time text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_settings jsonb not null default '{}',
  currency_settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_templates enable row level security;
alter table public.app_settings enable row level security;

create policy "profiles are owner readable"
on public.profiles for select
using (auth.uid() = id);

create policy "profiles are owner writable"
on public.profiles for all
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "jobs are owner readable"
on public.jobs for select
using (auth.uid() = user_id);

create policy "jobs are owner writable"
on public.jobs for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "shifts are owner readable"
on public.shifts for select
using (auth.uid() = user_id);

create policy "shifts are owner writable"
on public.shifts for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "shift templates are owner readable"
on public.shift_templates for select
using (auth.uid() = user_id);

create policy "shift templates are owner writable"
on public.shift_templates for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "app settings are owner readable"
on public.app_settings for select
using (auth.uid() = user_id);

create policy "app settings are owner writable"
on public.app_settings for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
