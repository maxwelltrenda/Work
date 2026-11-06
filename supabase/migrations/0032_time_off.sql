-- Team schedule: days off, vacation, sick days, training and so on, for
-- everyone on the team list, on all three sites. Anyone can add and remove
-- their own; admins (full, Facilities, Media and Events admins) can add and
-- remove anyone's.

create table if not exists time_off (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references team_members(id) on delete cascade,
  kind        text not null check (kind in ('Day off', 'Vacation', 'Sick', 'Training', 'Out of office', 'Other')),
  starts_on   date not null,
  ends_on     date not null,
  part        text check (part is null or part in ('Morning', 'Afternoon')),
  note        text,
  created_by  uuid references team_members(id),
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists time_off_dates_idx on time_off (starts_on, ends_on);

alter table time_off enable row level security;
create policy team_read on time_off for select to authenticated using (is_team_member());

create or replace function can_manage_time_off() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_team_admin() or is_site_admin('media') or is_site_admin('events'), false)
$$;

create or replace function time_off_add(p_member uuid, p_kind text, p_start date, p_end date,
                                        p_part text default null, p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_who uuid := coalesce(p_member, v_me);
  v_id bigint;
begin
  if v_me is null then raise exception 'Not on the team list'; end if;
  if v_who <> v_me and not can_manage_time_off() then raise exception 'You can only add your own time off'; end if;
  if p_start is null then raise exception 'Pick a date'; end if;
  if coalesce(p_end, p_start) < p_start then raise exception 'The end date is before the start date'; end if;
  if p_part is not null and coalesce(p_end, p_start) <> p_start then raise exception 'A half day is just one day'; end if;
  insert into time_off (member_id, kind, starts_on, ends_on, part, note, created_by)
  values (v_who, p_kind, p_start, coalesce(p_end, p_start), p_part, nullif(trim(p_note), ''), v_me)
  returning id into v_id;
  return v_id;
end $$;

create or replace function time_off_remove(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from time_off where id = p_id and (member_id = current_member_id() or can_manage_time_off());
  if not found then raise exception 'You can only remove your own time off'; end if;
end $$;

revoke execute on function can_manage_time_off(), time_off_add(uuid, text, date, date, text, text), time_off_remove(bigint) from public, anon;
grant execute on function can_manage_time_off(), time_off_add(uuid, text, date, date, text, text), time_off_remove(bigint) to authenticated;
