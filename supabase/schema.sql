-- Metti-only schema. This project is separate from Ramingo and travel-planner.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  city text not null default 'Prague',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.wardrobe_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null check (category in ('outer', 'top', 'bottom', 'shoes', 'accessory')),
  color text,
  image_path text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.saved_outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note text,
  temperature_c numeric,
  weather_code integer,
  item_ids uuid[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles enable row level security;
alter table public.wardrobe_items enable row level security;
alter table public.saved_outfits enable row level security;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.wardrobe_items to authenticated;
grant select, insert, update, delete on public.saved_outfits to authenticated;

create policy "profiles_select_own" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "wardrobe_select_own" on public.wardrobe_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "wardrobe_insert_own" on public.wardrobe_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "wardrobe_update_own" on public.wardrobe_items for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "wardrobe_delete_own" on public.wardrobe_items for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "outfits_select_own" on public.saved_outfits for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "outfits_insert_own" on public.saved_outfits for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "outfits_update_own" on public.saved_outfits for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "outfits_delete_own" on public.saved_outfits for delete to authenticated
  using ((select auth.uid()) = user_id);
