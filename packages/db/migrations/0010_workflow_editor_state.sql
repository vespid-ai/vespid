-- UI-only metadata for the graphical workflow editor.
alter table workflows
  add column if not exists editor_state jsonb;

