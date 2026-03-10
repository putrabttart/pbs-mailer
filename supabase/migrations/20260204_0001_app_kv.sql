create table if not exists public.app_kv (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_app_kv_updated_at on public.app_kv;

create trigger trg_app_kv_updated_at
before update on public.app_kv
for each row execute function public.set_updated_at();

alter table public.app_kv disable row level security;
