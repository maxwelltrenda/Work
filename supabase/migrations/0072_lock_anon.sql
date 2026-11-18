-- Security: people who aren't signed in could call some functions directly
-- with the site's public key (start/stop timers, send a request email reply).
-- Only the weekend plan is meant to be public (the Operations page reads it).
-- Signed-in access stays exactly as it was; each function still checks roles.
do $$
declare f record;
begin
  for f in select p.oid, p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    -- keep whoever can use it today (often only through PUBLIC) ...
    if has_function_privilege('authenticated', f.oid, 'execute') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if has_function_privilege('service_role', f.oid, 'execute') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
    -- ... and take it away from everyone who isn't signed in.
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
grant execute on function get_gameplan(date) to anon;

-- New functions aren't open to signed-out visitors by default.
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
