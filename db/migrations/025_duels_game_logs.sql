-- Full duels.ink game logs, persisted at import time (the match row only
-- keeps the summary). Raw text + parsed turn data are the foundation for
-- sim-engine work: real-play coverage priority, replay validation, policy
-- calibration, opponent scouting. FKs SET NULL so deleting an event/match
-- never destroys the underlying game data. Idempotent.

CREATE TABLE IF NOT EXISTS duels_game_logs (
  id           bigserial PRIMARY KEY,
  match_id     bigint REFERENCES matches(id) ON DELETE SET NULL,
  event_id     bigint REFERENCES events(id) ON DELETE SET NULL,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  my_player    int CHECK (my_player IN (1, 2)),
  winner       int CHECK (winner IN (1, 2)),
  first_player int CHECK (first_player IN (1, 2)),
  turns        int,
  raw_log      text NOT NULL,
  parsed       jsonb NOT NULL   -- {plays:{"1":{card:n},"2":{}}, quests:{...}, lore:{"1":n,"2":n}}
);
CREATE INDEX IF NOT EXISTS duels_game_logs_match_idx ON duels_game_logs (match_id);
CREATE INDEX IF NOT EXISTS duels_game_logs_time_idx ON duels_game_logs (imported_at);
