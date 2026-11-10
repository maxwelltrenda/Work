-- Weekend gameplan: the Facilities lead's plan for the weekend, written with
-- the weather in mind, for Skyler's Operations page. One row per weekend,
-- keyed by its Saturday. Facilities admins write it from the Facilities app;
-- the Operations page (no login) reads it through get_gameplan().

create table if not exists weekend_gameplan (
  weekend_of  date primary key check (extract(dow from weekend_of) = 6),
  status      text not null default 'normal' check (status in ('normal', 'watch', 'action')),
  plan        text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table weekend_gameplan enable row level security;
drop policy if exists gameplan_read on weekend_gameplan;
create policy gameplan_read on weekend_gameplan for select to authenticated using (true);

create or replace function get_gameplan(p_weekend date)
returns table (weekend_of date, status text, plan text, updated_at timestamptz, updated_by text)
language sql stable security definer set search_path = public as $$
  select g.weekend_of, g.status, g.plan, g.updated_at, g.updated_by from weekend_gameplan g where g.weekend_of = p_weekend
$$;

create or replace function set_gameplan(p_weekend date, p_status text, p_plan text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_admin() then raise exception 'Only Facilities admins can update the weekend gameplan'; end if;
  if extract(dow from p_weekend) <> 6 then raise exception 'Pick the weekend by its Saturday'; end if;
  insert into weekend_gameplan (weekend_of, status, plan, updated_at, updated_by)
  values (p_weekend, coalesce(p_status, 'normal'), nullif(trim(p_plan), ''), now(), my_name())
  on conflict (weekend_of) do update set status = excluded.status, plan = excluded.plan, updated_at = now(), updated_by = excluded.updated_by;
end $$;

revoke execute on function get_gameplan(date) from public;
grant execute on function get_gameplan(date) to anon, authenticated;
revoke execute on function set_gameplan(date, text, text) from public, anon;
grant execute on function set_gameplan(date, text, text) to authenticated;
