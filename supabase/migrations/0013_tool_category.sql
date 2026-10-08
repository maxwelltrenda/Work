-- Free-text category for tools (Power Tools, Hand Tools, Ladders…).
alter table tools add column if not exists category text;
create index if not exists tools_category_idx on tools (category);
