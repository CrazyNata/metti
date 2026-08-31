-- Applied to the Metti Supabase project on 2026-08-31.
-- Keep this migration in source control so a new environment can reproduce
-- the profile, wardrobe, outfit and private Storage model.

alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb,
  add column if not exists style_tags text[] not null default '{}',
  add column if not exists style_profile jsonb not null default '{}'::jsonb;

alter table public.wardrobe_items
  add column if not exists brand text,
  add column if not exists size text,
  add column if not exists season text,
  add column if not exists notes text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.saved_outfits
  add column if not exists prompt text,
  add column if not exists is_worn boolean not null default false,
  add column if not exists worn_at timestamptz,
  add column if not exists updated_at timestamptz not null default timezone('utc', now()),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wardrobe', 'wardrobe', false, 5242880, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
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
