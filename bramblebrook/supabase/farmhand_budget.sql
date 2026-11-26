-- Applied as migration "farmhand_budget". The hire page lists farmhands within a budget: farmhand_market(p_q, p_min, p_max)
-- keeps only players whose hire price is between p_min and p_max (p_max null: no top), best first. It is an overload with
-- no defaults, so a call with p_q alone still reaches the old one-argument function (old games keep working).
-- svc_act passes p_min / p_max through for the Claude connector when they are given.
create or replace function public.farmhand_market(p_q text, p_min bigint, p_max bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.value desc), '[]'::jsonb) from (
    select f.user_id as id, p.username, coalesce(nullif(f.state->>'name', ''), p.username) as name, f.value, greatest(100, f.value) as price,
      exists (select 1 from public.farmhands h where h.owner = auth.uid() and h.hand = f.user_id) as hired,
      (select count(*) from public.farmhands h where h.hand = f.user_id) as hired_by,
      (p.show_online and p.last_seen > now() - interval '5 minutes') as online
    from public.farms f join public.profiles p on p.id = f.user_id
    where auth.uid() is not null and f.user_id <> auth.uid() and coalesce(f.state->>'name', '') <> ''
      and greatest(100, f.value) >= greatest(0, coalesce(p_min, 0)) and (p_max is null or greatest(100, f.value) <= p_max)
      and not exists (select 1 from public.blocks b where (b.blocker = auth.uid() and b.blocked = f.user_id) or (b.blocker = f.user_id and b.blocked = auth.uid()))
      and (coalesce(btrim(p_q), '') = '' or p.username ilike '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%'
           or (f.state->>'name') ilike '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%')
    order by f.value desc limit 60) x;
$$;
revoke all on function public.farmhand_market(text, bigint, bigint) from public, anon;
grant execute on function public.farmhand_market(text, bigint, bigint) to authenticated;
-- svc_act: 'farmhand_market' now reads
--   when 'farmhand_market' then
--     if p_args ? 'p_max' or p_args ? 'p_min' then r := public.farmhand_market(coalesce(p_args->>'p_q', ''), (p_args->>'p_min')::bigint, (p_args->>'p_max')::bigint);
--     else r := public.farmhand_market(coalesce(p_args->>'p_q', '')); end if;
-- (the rest of svc_act is unchanged)
