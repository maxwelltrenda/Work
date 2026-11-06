-- Facilities only: each person's team (Maintenance, Custodial, ...) and regular
-- weekly hours, shown on the Team schedule. Set by full and Facilities admins.
-- The Team schedule (and its time off) is just for the Facilities team now, so
-- time off is limited to Facilities people and managed by Facilities admins.
--   work_hours = {"mon": {"start": "08:00", "end": "16:30"}, "tue": ..., } —
--   a day that's missing or null is a day off.

alter table team_members add column if not exists team text;
alter table team_members add column if not exists work_hours jsonb not null default '{}'::jsonb;

create or replace function set_member_schedule(p_member uuid, p_team text, p_hours jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  m team_members;
  d text;
  v jsonb;
  clean jsonb := '{}'::jsonb;
begin
  select * into m from team_members where id = p_member for update;
  if not found then raise exception 'No such person'; end if;
  if not is_team_admin() then raise exception 'Only an admin can set someone''s team and hours'; end if;
  for d in select unnest(array['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) loop
    v := p_hours -> d;
    if v is null or jsonb_typeof(v) <> 'object' then continue; end if;
    if coalesce(v ->> 'start', '') !~ '^\d{2}:\d{2}$' or coalesce(v ->> 'end', '') !~ '^\d{2}:\d{2}$' then
      raise exception 'Give a start and end time for %', d;
    end if;
    if (v ->> 'end') <= (v ->> 'start') then raise exception 'The end time is before the start time on %', d; end if;
    clean := clean || jsonb_build_object(d, jsonb_build_object('start', v ->> 'start', 'end', v ->> 'end'));
  end loop;
  perform set_config('app.team_edit', 'on', true);
  update team_members set team = nullif(trim(p_team), ''), work_hours = clean where id = p_member;
end $$;

revoke execute on function set_member_schedule(uuid, text, jsonb) from public, anon;
grant execute on function set_member_schedule(uuid, text, jsonb) to authenticated;

-- Time off: Facilities team only.
alter policy team_read on time_off using (can_see_boards());

create or replace function can_manage_time_off() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_team_admin(), false)
$$;

create or replace function time_off_add(p_member uuid, p_kind text, p_start date, p_end date,
                                        p_part text default null, p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_who uuid := coalesce(p_member, v_me);
  v_id bigint;
begin
  if v_me is null or coalesce(my_role(), 'none') in ('none', 'kiosk') then raise exception 'The team schedule is for the Facilities team'; end if;
  if v_who <> v_me and not can_manage_time_off() then raise exception 'You can only add your own time off'; end if;
  if (select role from team_members where id = v_who) in ('none', 'kiosk') then raise exception 'They aren''t on the Facilities team'; end if;
  if p_start is null then raise exception 'Pick a date'; end if;
  if coalesce(p_end, p_start) < p_start then raise exception 'The end date is before the start date'; end if;
  if p_part is not null and coalesce(p_end, p_start) <> p_start then raise exception 'A half day is just one day'; end if;
  insert into time_off (member_id, kind, starts_on, ends_on, part, note, created_by)
  values (v_who, p_kind, p_start, coalesce(p_end, p_start), p_part, nullif(trim(p_note), ''), v_me)
  returning id into v_id;
  return v_id;
end $$;
