-- Deletion tombstones: deck_events cascade-deletes with its deck, so hard
-- deletes used to leave nothing but an id gap in the sequence. Every deck
-- delete now records what was deleted — including the full card list, so a
-- tombstone doubles as a recoverable archive. No FK on deck_id (the deck is
-- gone; the id names the gap). Idempotent.

CREATE TABLE IF NOT EXISTS deck_tombstones (
  id             bigserial PRIMARY KEY,
  deck_id        bigint NOT NULL,
  name           text NOT NULL,
  format         text,
  sim_only       boolean,
  strategy       text,
  notes          text,
  card_total     int,
  cards          jsonb,               -- [{card_id, qty, full_name}]
  created_at     timestamptz,
  deleted_at     timestamptz NOT NULL DEFAULT now(),
  deleted_source text                 -- webui | mcp | api
);
CREATE INDEX IF NOT EXISTS deck_tombstones_deck_idx ON deck_tombstones (deck_id);
