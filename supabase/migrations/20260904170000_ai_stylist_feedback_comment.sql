alter table public.outfit_feedback
  add column if not exists comment text;

alter table public.outfit_feedback
  drop constraint if exists outfit_feedback_comment_length_check;

alter table public.outfit_feedback
  add constraint outfit_feedback_comment_length_check
  check (comment is null or char_length(comment) <= 1000);
