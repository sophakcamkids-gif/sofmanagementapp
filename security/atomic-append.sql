-- Atomic append for the shared pending arrays (payments / loan requests).
--
-- Run once in the Supabase SQL editor. Fixes silently-dropped member submissions:
-- the server used to read the array, prepend, and write it back — two submissions
-- landing in the same window (made wider by the serverless round-trip) clobbered
-- each other. This function prepends in ONE statement; the ON CONFLICT row lock
-- serialises concurrent calls, so nothing is lost. /api/state calls it via the
-- service key (see sbAppend in api/_secure.js), which falls back to the old path
-- until this exists — so running it is safe at any time.

create or replace function append_to_state(p_key text, p_item jsonb)
returns void
language sql
as $$
  insert into app_state (key, value, updated_at)
  values (p_key, jsonb_build_array(p_item), now())
  on conflict (key) do update
    set value = jsonb_build_array(p_item) || app_state.value,
        updated_at = now();
$$;

-- Only the server (service_role) may call it; the browser's anon key cannot.
revoke all on function append_to_state(text, jsonb) from public;
grant execute on function append_to_state(text, jsonb) to service_role;
