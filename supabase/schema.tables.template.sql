-- Supabase schema template (structured tables)
-- Copy this file and edit table names if starting a new project.

create table if not exists public.app_aliases (
  address text primary key,
  created_at timestamptz,
  last_used_at timestamptz,
  hits integer not null default 0,
  active boolean not null default true
);

create table if not exists public.app_domains (
  name text primary key,
  active boolean not null default true,
  created_at timestamptz
);

create table if not exists public.app_logs (
  id text primary key,
  alias text,
  from_email text,
  subject text,
  date text,
  snippet text,
  last_seen_at timestamptz
);

create table if not exists public.app_audit (
  id bigint generated always as identity primary key,
  timestamp timestamptz not null,
  action text not null,
  ip text,
  user_agent text,
  meta jsonb
);

alter table public.app_aliases disable row level security;
alter table public.app_domains disable row level security;
alter table public.app_logs disable row level security;
alter table public.app_audit disable row level security;
