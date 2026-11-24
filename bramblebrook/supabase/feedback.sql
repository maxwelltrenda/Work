-- Feedback: players (and friends without an account, from the website) tell the game's maker what broke or what
-- they'd like. Each one pings the owner's bell; the owner reads and answers them in the game (Settings › Feedback
-- inbox, or the bell), and Claude can read the table directly. Applied live as the migrations `feedback`,
-- `feedback_reply_wording`, `feedback_without_account` and `feedback_wontfix_wording`; this file is the result.

create table public.game_admins (user_id uuid primary key references auth.users (id) on delete cascade);
alter table public.game_admins enable row level security;   -- no policies: only security-definer functions read it
-- the owner was added by hand: insert into public.game_admins (user_id) values ('<the owner''s account id>');

create table public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,   -- null = sent without an account
  kind text not null check (kind in ('bug', 'idea', 'other')),
  body text not null check (char_length(body) between 3 and 2000),
  context jsonb not null default '{}'::jsonb,   -- screen, day, levels, device, last taps/toasts/errors (see 82-feedback.js)
  status text not null default 'new' check (status in ('new', 'seen', 'fixed', 'wontfix')),
  reply text,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index feedback_recent on public.feedback (id desc);
alter table public.feedback enable row level security;
create policy "players see their own feedback" on public.feedback for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_game_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.game_admins where user_id = auth.uid());
$$;

-- Anyone can send; 10 an hour per player, and 10 an hour across everyone without an account.
create or replace function public.send_feedback(p_kind text, p_body text, p_context jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b text := btrim(coalesce(p_body, '')); fid bigint; who text; me uuid := auth.uid();
  ctx jsonb := case when octet_length(coalesce(p_context, '{}'::jsonb)::text) <= 8000 then coalesce(p_context, '{}'::jsonb) else '{}'::jsonb end;
begin
  if p_kind not in ('bug', 'idea', 'other') then raise exception 'Pick bug, idea or other.'; end if;
  if char_length(b) < 3 then raise exception 'Write a few words first.'; end if;
  if char_length(b) > 2000 then raise exception 'That is a bit long: 2,000 characters at most.'; end if;
  if me is null then
    if (select count(*) from public.feedback where user_id is null and created_at > now() - interval '1 hour') >= 10 then
      raise exception 'Lots of feedback just came in. Please try again in a little while.';
    end if;
  elsif (select count(*) from public.feedback where user_id = me and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Thanks for all the feedback! Please wait a little before sending more.';
  end if;
  insert into public.feedback (user_id, kind, body, context) values (me, p_kind, b, ctx) returning id into fid;
  who := case when me is null then coalesce(nullif(left(btrim(ctx->>'farmer'), 30), ''), 'Someone') || ' (no account)'
              else coalesce(public.player_name(me), 'A player') end;
  insert into public.notifications (user_id, kind, icon, body, link, actor)
    select a.user_id, 'feedback', case p_kind when 'bug' then '🐞' when 'idea' then '💡' else '💬' end,
           who || ': ' || left(b, 140) || case when char_length(b) > 140 then '…' else '' end, '{"to":"feedback"}'::jsonb, me
    from public.game_admins a where me is null or a.user_id <> me;
  return jsonb_build_object('ok', true, 'id', fid);
end $$;
revoke all on function public.send_feedback(text, text, jsonb) from public;
grant execute on function public.send_feedback(text, text, jsonb) to anon, authenticated;

create or replace function public.feedback_inbox()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_game_admin() then raise exception 'Only the game''s owner can see the feedback inbox.'; end if;
  return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
    select f.id, f.user_id, f.kind, f.body, f.context, f.status, f.reply, f.created_at, f.handled_at,
           coalesce(nullif(p.public->>'name', ''), p.username, nullif(f.context->>'farmer', '')) as name, p.username
    from public.feedback f left join public.profiles p on p.id = f.user_id
    order by f.id desc limit 60) x), '[]'::jsonb));
end $$;
revoke all on function public.feedback_inbox() from public, anon;
grant execute on function public.feedback_inbox() to authenticated;

-- Fixed, Won't fix and a reply each send the player a note in their bell; "Got it" (seen) does not.
create or replace function public.feedback_mark(p_id bigint, p_status text, p_reply text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.feedback; r text := nullif(btrim(coalesce(p_reply, '')), ''); quote text;
begin
  if not public.is_game_admin() then raise exception 'Only the game''s owner can do that.'; end if;
  if p_status not in ('seen', 'fixed', 'wontfix') then raise exception 'Unknown status.'; end if;
  update public.feedback set status = p_status, reply = coalesce(r, reply), handled_at = now() where id = p_id returning * into f;
  if f.id is null then raise exception 'That feedback could not be found.'; end if;
  quote := '"' || left(f.body, 60) || case when char_length(f.body) > 60 then '…' else '' end || '"';
  if f.user_id is not null and f.user_id <> auth.uid() and (p_status in ('fixed', 'wontfix') or r is not null) then
    insert into public.notifications (user_id, kind, icon, body, link, actor) values (f.user_id, 'feedback',
      case when p_status = 'fixed' then '✅' else '💬' end,
      case when p_status = 'fixed' then 'Fixed, thanks to you: ' || quote
           when p_status = 'wontfix' and r is null then 'Thanks for your feedback ' || quote || '. It was looked at, and it is staying as it is for now.'
           else 'About your feedback ' || quote end
        || case when r is not null then ' Reply from the developer: ' || left(r, 200) else '' end,
      '{}'::jsonb, auth.uid());
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.feedback_mark(bigint, text, text) from public, anon;
grant execute on function public.feedback_mark(bigint, text, text) to authenticated;

-- social_ping also returns admin (is this the owner) and feedback_new (how many are still New), and svc_act
-- (the Claude connector's way in) gained send_feedback, feedback_inbox and feedback_mark.
