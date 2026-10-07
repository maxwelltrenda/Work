-- Track when each barcode label was last printed, so the Labels page can show
-- what still needs a label.

alter table items        add column if not exists label_printed_at timestamptz;
alter table tools        add column if not exists label_printed_at timestamptz;
alter table team_members add column if not exists label_printed_at timestamptz;

-- Mark (or unmark, for an undo) labels as printed. Any team member who can
-- print labels may call it; it only ever touches label_printed_at.
create or replace function mark_labels_printed(p_kind text, p_ids uuid[], p_printed boolean default true)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_at timestamptz := case when p_printed then now() else null end;
  v_count integer;
begin
  if not is_team_member() then raise exception 'Not on the team list'; end if;
  if p_kind = 'item' then
    update items set label_printed_at = v_at where id = any(p_ids);
  elsif p_kind = 'tool' then
    update tools set label_printed_at = v_at where id = any(p_ids);
  elsif p_kind = 'person' then
    update team_members set label_printed_at = v_at where id = any(p_ids);
  else
    raise exception 'Unknown label kind';
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function mark_labels_printed(text, uuid[], boolean) from public, anon;
grant execute on function mark_labels_printed(text, uuid[], boolean) to authenticated;
