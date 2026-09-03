-- Metti-only schema. This project is separate from Ramingo and travel-planner.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  city text not null default 'Prague',
  preferences jsonb not null default '{}'::jsonb,
  style_tags text[] not null default '{}',
  style_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.wardrobe_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null check (category in ('outer', 'top', 'bottom', 'shoes', 'accessory')),
  color text,
  size text,
  season text,
  brand text,
  notes text,
  image_path text,
  original_image_path text,
  processed_image_path text,
  image_status text not null default 'none'
    check (image_status in ('none', 'pending', 'processing', 'attached', 'needs_review', 'failed')),
  image_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table if not exists public.saved_outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note text,
  prompt text,
  temperature_c numeric,
  weather_code integer,
  item_ids uuid[] not null default '{}',
  is_worn boolean not null default false,
  worn_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.wardrobe_items enable row level security;
alter table public.saved_outfits enable row level security;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.wardrobe_items to authenticated;
grant select, insert, update, delete on public.saved_outfits to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "wardrobe_select_own" on public.wardrobe_items;
create policy "wardrobe_select_own" on public.wardrobe_items for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "wardrobe_insert_own" on public.wardrobe_items;
create policy "wardrobe_insert_own" on public.wardrobe_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "wardrobe_update_own" on public.wardrobe_items;
create policy "wardrobe_update_own" on public.wardrobe_items for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "wardrobe_delete_own" on public.wardrobe_items;
create policy "wardrobe_delete_own" on public.wardrobe_items for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "outfits_select_own" on public.saved_outfits;
create policy "outfits_select_own" on public.saved_outfits for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "outfits_insert_own" on public.saved_outfits;
create policy "outfits_insert_own" on public.saved_outfits for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "outfits_update_own" on public.saved_outfits;
create policy "outfits_update_own" on public.saved_outfits for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "outfits_delete_own" on public.saved_outfits;
create policy "outfits_delete_own" on public.saved_outfits for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists wardrobe_items_set_updated_at on public.wardrobe_items;
create trigger wardrobe_items_set_updated_at before update on public.wardrobe_items
for each row execute function public.set_updated_at();
drop trigger if exists saved_outfits_set_updated_at on public.saved_outfits;
create trigger saved_outfits_set_updated_at before update on public.saved_outfits
for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wardrobe', 'wardrobe', false, 5242880, array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/svg+xml'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "wardrobe_storage_select_own" on storage.objects;
create policy "wardrobe_storage_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists "wardrobe_storage_insert_own" on storage.objects;
create policy "wardrobe_storage_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists "wardrobe_storage_update_own" on storage.objects;
create policy "wardrobe_storage_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists "wardrobe_storage_delete_own" on storage.objects;
create policy "wardrobe_storage_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid()::text));

create index if not exists wardrobe_items_user_created_idx on public.wardrobe_items (user_id, created_at desc);
create index if not exists saved_outfits_user_created_idx on public.saved_outfits (user_id, created_at desc);
create index if not exists saved_outfits_user_worn_idx on public.saved_outfits (user_id, is_worn, worn_at desc);
create index if not exists wardrobe_items_user_archived_created_idx on public.wardrobe_items (user_id, archived_at, created_at desc);
create index if not exists saved_outfits_user_archived_created_idx on public.saved_outfits (user_id, archived_at, created_at desc);
