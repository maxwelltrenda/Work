-- An editable list of categories for tools and maintenance stock, managed on
-- the Categories page like locations. Tools and items keep the category name
-- as text; renaming carries through to them, removing clears it from them.

create table if not exists categories (
  kind        text not null check (kind in ('tool', 'maintenance')),
  name        text not null check (length(trim(name)) > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (kind, name)
);
alter table categories enable row level security;
create policy team_read    on categories for select to authenticated using (is_team_member());
create policy admin_insert on categories for insert to authenticated with check (is_team_admin());
create policy admin_update on categories for update to authenticated using (is_team_admin()) with check (is_team_admin());

-- Start with the suggestions the forms used to offer, plus anything already in use.
insert into categories (kind, name)
select 'tool', unnest(array['Power Tools', 'Hand Tools', 'Ladders & Lifts', 'Lawn & Garden', 'Cleaning Equipment',
                            'Measuring & Layout', 'Electrical', 'Plumbing', 'Painting', 'Safety'])
on conflict do nothing;
insert into categories (kind, name)
select 'maintenance', unnest(array['Plumbing', 'Electrical', 'Paint & Caulk', 'Cleaning & Chemicals', 'HVAC & Filters',
                                   'Hardware & Fasteners', 'Lighting', 'Lubricants'])
on conflict do nothing;
insert into categories (kind, name) select distinct 'tool', trim(category) from tools where trim(coalesce(category, '')) <> '' on conflict do nothing;
insert into categories (kind, name) select distinct 'maintenance', trim(subcategory) from items where trim(coalesce(subcategory, '')) <> '' on conflict do nothing;

-- Add (or bring back) a category.
create or replace function add_category(p_kind text, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(p_name);
begin
  if not is_team_admin() then raise exception 'Admins only'; end if;
  if p_kind not in ('tool', 'maintenance') then raise exception 'Bad category type'; end if;
  if v_name = '' then raise exception 'Enter a name'; end if;
  insert into categories (kind, name) values (p_kind, v_name)
  on conflict (kind, name) do update set active = true;
  return v_name;
end $$;

-- Rename a category everywhere it's used. Renaming onto an existing name merges them.
create or replace function rename_category(p_kind text, p_old text, p_new text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_new text := trim(p_new);
  v_n integer;
begin
  if not is_team_admin() then raise exception 'Admins only'; end if;
  if p_kind not in ('tool', 'maintenance') then raise exception 'Bad category type'; end if;
  if v_new = '' then raise exception 'Enter a name'; end if;
  insert into categories (kind, name) values (p_kind, v_new) on conflict (kind, name) do update set active = true;
  if v_new <> p_old then
    update categories set active = false where kind = p_kind and name = p_old;
  end if;
  if p_kind = 'tool' then
    update tools set category = v_new where category = p_old;
  else
    update items set subcategory = v_new where subcategory = p_old and category = 'maintenance';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Take a category off the list and clear it from anything that uses it.
create or replace function remove_category(p_kind text, p_name text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not is_team_admin() then raise exception 'Admins only'; end if;
  update categories set active = false where kind = p_kind and name = p_name;
  if p_kind = 'tool' then
    update tools set category = null where category = p_name;
  else
    update items set subcategory = null where subcategory = p_name and category = 'maintenance';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function add_category(text, text), rename_category(text, text, text), remove_category(text, text) from public, anon;
grant execute on function add_category(text, text), rename_category(text, text, text), remove_category(text, text) to authenticated;
