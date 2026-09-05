create table if not exists public.outfit_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outfit_id uuid not null references public.saved_outfits(id) on delete cascade,
  reaction text not null check (reaction in ('like', 'dislike')),
  reason text check (
    reason is null or reason in (
      'too_formal',
      'too_casual',
      'too_boring',
      'too_bright',
      'too_dark',
      'not_my_style',
      'bad_proportions',
      'wrong_shoes',
      'too_many_layers',
      'other'
    )
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, outfit_id)
);

alter table public.outfit_feedback enable row level security;

grant select, insert, update, delete on public.outfit_feedback to authenticated;

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

drop policy if exists "outfit_feedback_select_own" on public.outfit_feedback;
create policy "outfit_feedback_select_own" on public.outfit_feedback
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "outfit_feedback_insert_own" on public.outfit_feedback;
create policy "outfit_feedback_insert_own" on public.outfit_feedback
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.saved_outfits
    where saved_outfits.id = outfit_feedback.outfit_id
      and saved_outfits.user_id = (select auth.uid())
  )
);

drop policy if exists "outfit_feedback_update_own" on public.outfit_feedback;
create policy "outfit_feedback_update_own" on public.outfit_feedback
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "outfit_feedback_delete_own" on public.outfit_feedback;
create policy "outfit_feedback_delete_own" on public.outfit_feedback
for delete to authenticated
using ((select auth.uid()) = user_id);

drop trigger if exists outfit_feedback_set_updated_at on public.outfit_feedback;
create trigger outfit_feedback_set_updated_at
before update on public.outfit_feedback
for each row execute function public.set_updated_at();

create index if not exists outfit_feedback_user_created_idx
on public.outfit_feedback (user_id, created_at desc);
