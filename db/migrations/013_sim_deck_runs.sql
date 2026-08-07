-- Deck simulation runs: queued from the web UI or Claude (MCP), claimed
-- and executed by the lorcana-sim worker (Lorcana-Sim repo,
-- src/lorcana_engine/simrunner.py), displayed on the deck's Sim tab.
--
-- status: queued -> running -> complete | unsupported | error
--   unsupported = the engine cannot play some card in the deck
--   faithfully; unsupported_cards says which and why. Never a partial
--   or approximated result.
CREATE TABLE IF NOT EXISTS sim_deck_runs (
  id                bigserial PRIMARY KEY,
  deck_id           integer NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  opponent          text NOT NULL DEFAULT 'deck3',   -- 'deck2'|'deck3'|<deck id>
  opponent_label    text,
  games             integer NOT NULL DEFAULT 200,
  policy            text NOT NULL DEFAULT 'heuristic',
  seed_base         bigint,
  status            text NOT NULL DEFAULT 'queued',
  requested_by      text,                            -- 'webui' | 'mcp' | 'api'
  requested_at      timestamptz NOT NULL DEFAULT now(),
  claimed_at        timestamptz,
  finished_at       timestamptz,
  worker            text,
  engine_build      text,
  -- results (null until complete)
  wins              integer,
  losses            integer,
  win_rate          numeric(6,4),
  avg_turns         numeric(6,1),
  wins_as_p0        integer,
  wins_as_p1        integer,
  elapsed_s         numeric(8,1),
  error             text,
  unsupported_cards jsonb
);

CREATE INDEX IF NOT EXISTS sim_deck_runs_deck_idx ON sim_deck_runs (deck_id, requested_at DESC);
-- Partial index over the claim path (queued rows are a tiny minority).
CREATE INDEX IF NOT EXISTS sim_deck_runs_queued_idx ON sim_deck_runs (requested_at)
  WHERE status = 'queued';
