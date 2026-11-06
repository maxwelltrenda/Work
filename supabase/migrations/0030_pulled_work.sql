-- "I got pulled to something": a log of unplanned work during the day, for both
-- the custodial Checklist and the Maintenance schedule. Anyone on the Facilities
-- team taps the button, says what and where, and it's logged under their name
-- for today with a running clock, so everyone can see where people are even
-- when they're off the plan. Starting a new one ends their last one; "I'm back"
-- ends it. Kept as history.

create table if not exists pulled_work (
  id          bigint generated always as identity primary key,
  dept        text not null check (dept in ('custodial', 'maintenance')),
  member_id   uuid not null references team_members(id),
  what        text not null check (trim(what) <> ''),
  location    text,
  request_id  bigint references maint_requests(id) on delete set null,
  day         date not null default ((now() at time zone 'America/Chicago')::date),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  note        text
);
create index if not exists pulled_work_day_idx on pulled_work (day, dept);
create index if not exists pulled_work_open_idx on pulled_work (member_id) where ended_at is null;

alter table pulled_work enable row level security;
create policy pulled_read on pulled_work for select to authenticated using (can_see_boards());

create or replace function pulled_start(p_dept text, p_what text, p_location text default null, p_request bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_id bigint;
begin
  if v_me is null or not can_edit_boards() then raise exception 'Only the Facilities team can log this'; end if;
  if p_dept not in ('custodial', 'maintenance') then raise exception 'Bad department'; end if;
  if coalesce(trim(p_what), '') = '' then raise exception 'Say what you got pulled to'; end if;
  update pulled_work set ended_at = now() where member_id = v_me and ended_at is null;
  insert into pulled_work (dept, member_id, what, location, request_id)
  values (p_dept, v_me, trim(p_what), nullif(trim(p_location), ''), p_request)
  returning id into v_id;
  return v_id;
end $$;

-- End it: your own, or anyone's if you're an admin.
create or replace function pulled_end(p_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pulled_work set ended_at = now(), note = coalesce(nullif(trim(p_note), ''), note)
   where id = p_id and ended_at is null and (member_id = current_member_id() or is_team_admin());
  if not found then raise exception 'That one is already finished, or isn''t yours'; end if;
end $$;

revoke execute on function pulled_start(text, text, text, bigint), pulled_end(bigint, text) from public, anon;
grant execute on function pulled_start(text, text, text, bigint), pulled_end(bigint, text) to authenticated;
