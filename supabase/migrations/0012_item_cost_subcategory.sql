-- Cost per box/pack (or per piece for single items) for facilities and
-- maintenance stock, and a free-text category for maintenance stock
-- (Plumbing, Electrical, Paint & Caulk…).

alter table items add column if not exists unit_cost numeric(10, 2) check (unit_cost is null or unit_cost >= 0);
alter table items add column if not exists subcategory text;
create index if not exists items_subcategory_idx on items (subcategory);
