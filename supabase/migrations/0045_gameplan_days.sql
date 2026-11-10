-- Weekend gameplan per day: { "fri": {status, plan}, "sat": {...}, "sun": {...} }.
-- The weekend's status is the most serious of its days (for the corner tag).

alter table weekend_gameplan add column if not exists days jsonb not null default '{}';

drop function if exists get_gameplan(date);
create function get_gameplan(p_weekend date)
returns table (weekend_of date, status text, plan text, days jsonb, updated_at timestamptz, updated_by text)
language sql stable security definer set search_path = public as $$
  select g.weekend_of, g.status, g.plan, g.days, g.updated_at, g.updated_by from weekend_gameplan g where g.weekend_of = p_weekend
$$;
revoke execute on function get_gameplan(date) from public;
grant execute on function get_gameplan(date) to anon, authenticated;

create or replace function set_gameplan_days(p_weekend date, p_days jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_days jsonb := '{}';
  v_status text := 'normal';
  k text;
  st text;
  pl text;
begin
  if not is_team_admin() then raise exception 'Only Facilities admins can update the weekend gameplan'; end if;
  if extract(dow from p_weekend) <> 6 then raise exception 'Pick the weekend by its Saturday'; end if;
  foreach k in array array['fri', 'sat', 'sun'] loop
    st := coalesce(p_days->k->>'status', 'normal');
    if st not in ('normal', 'watch', 'action') then st := 'normal'; end if;
    pl := nullif(trim(coalesce(p_days->k->>'plan', '')), '');
    v_days := v_days || jsonb_build_object(k, jsonb_build_object('status', st, 'plan', pl));
    if st = 'action' or (st = 'watch' and v_status = 'normal') then v_status := st; end if;
  end loop;
  insert into weekend_gameplan (weekend_of, status, plan, days, updated_at, updated_by)
  values (p_weekend, v_status, null, v_days, now(), my_name())
  on conflict (weekend_of) do update set status = excluded.status, plan = null, days = excluded.days, updated_at = now(), updated_by = excluded.updated_by;
end $$;
revoke execute on function set_gameplan_days(date, jsonb) from public, anon;
grant execute on function set_gameplan_days(date, jsonb) to authenticated;
