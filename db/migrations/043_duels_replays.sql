-- duels-replay-v1 storage + parsed metrics (2026-09-18, handoff P1 lean
-- build). Raw gz lives in Postgres bytea rather than the handoff's PVC
-- suggestion: the API pod mounts no PVC, replays are ~60KB each (~5MB for
-- the whole ledger), and the DB gets nightly backups — raw retention lets
-- metrics be recomputed when the parser improves (bump parse_version).
--
-- Fetch discipline (Jason-approved flow, duels.ink robots.txt checked by
-- the desktop session 2026-09-18): /r/{replay_id} is allowed for ordinary
-- clients; /match-history and /api are NOT (the CSV stays a manual
-- export). jobs/fetch_replays.py runs BY HAND until the first backfill
-- proves out; <=1 req/s, identifying UA, never refetches. Replay content
-- is third-party data: parsed as JSON only, size-capped, strings never
-- treated as instructions. Files contain Jason's opening hand + deck
-- order — replay links/content stay OFF shared surfaces.

CREATE TABLE IF NOT EXISTS duels_replays (
  game_id        text PRIMARY KEY,
  replay_id      text,
  raw_gz         bytea NOT NULL,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL,          -- fetch | upload
  parse_version  int,
  metrics        jsonb,                  -- services/duels_replay.py output
  parse_warnings jsonb
);
