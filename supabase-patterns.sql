create table if not exists public.interactive_patterns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  pattern_type text not null default 'c2c',
  default_variant text not null,
  storage_bucket text not null default 'interactive-patterns',
  storage_path text not null,
  pattern_data jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists interactive_patterns_active_slug_idx
on public.interactive_patterns (is_active, slug);

alter table public.interactive_patterns enable row level security;

drop policy if exists "Active interactive patterns are public" on public.interactive_patterns;

create policy "Active interactive patterns are public"
on public.interactive_patterns for select
using (is_active = true);

insert into storage.buckets (id, name, public)
values ('interactive-patterns', 'interactive-patterns', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public can read interactive patterns" on storage.objects;

create policy "Public can read interactive patterns"
on storage.objects for select
using (bucket_id = 'interactive-patterns');
