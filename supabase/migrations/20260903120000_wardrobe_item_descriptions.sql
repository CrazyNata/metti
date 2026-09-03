-- Add a first-class description for wardrobe items.
-- The existing notes field remains for private user notes; description is the
-- recognition-generated, user-visible item summary exposed through MCP.
alter table public.wardrobe_items
  add column if not exists description text;
