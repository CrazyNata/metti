-- Backend-owned wardrobe image processing.
-- The legacy image_path column remains the display alias for old clients;
-- original_image_path and processed_image_path keep the two artifacts distinct.

alter table public.wardrobe_items
  add column if not exists original_image_path text,
  add column if not exists processed_image_path text,
  add column if not exists image_status text not null default 'none',
  add column if not exists image_error text;

alter table public.wardrobe_items
  drop constraint if exists wardrobe_items_image_status_check;

alter table public.wardrobe_items
  add constraint wardrobe_items_image_status_check
  check (image_status in ('none', 'pending', 'processing', 'attached', 'needs_review', 'failed'));

-- Existing MCP rows were uploaded as the original and marked for a later app
-- pass. Preserve them as safe fallbacks instead of treating the old result as
-- a finished processed image.
update public.wardrobe_items
set original_image_path = coalesce(original_image_path, image_path),
    image_status = case
      when image_path is null then 'none'
      else 'needs_review'
    end
where (metadata ->> 'image_source') = 'mcp'
   or (metadata ->> 'image_background') is not null;

-- Rows from the ordinary app flow had one display path and no version
-- metadata. Treat that path as the processed/display artifact for backwards
-- compatibility; new writes always create both explicit variants.
update public.wardrobe_items
set processed_image_path = coalesce(processed_image_path, image_path),
    image_status = case
      when image_path is null then 'none'
      else 'attached'
    end
where original_image_path is null
  and image_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wardrobe', 'wardrobe', false, 5242880,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/svg+xml'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
