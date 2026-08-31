-- Additive migration for MCP soft-archive support.
-- The original data-storage migration is already applied and remains unchanged.

alter table public.wardrobe_items
  add column if not exists archived_at timestamptz;

alter table public.saved_outfits
  add column if not exists archived_at timestamptz;

create index if not exists wardrobe_items_user_archived_created_idx
  on public.wardrobe_items (user_id, archived_at, created_at desc);

create index if not exists saved_outfits_user_archived_created_idx
  on public.saved_outfits (user_id, archived_at, created_at desc);
