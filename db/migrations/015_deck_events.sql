-- Deck lifecycle audit: built/unbuilt/created/cloned, with the reason —
-- answers "where did my physical copies go" after on-the-fly rebuilds
-- (e.g. "unbuilt — copies pulled for 'Ruby/Steel v4'").
CREATE TABLE IF NOT EXISTS deck_events (
  id       bigserial PRIMARY KEY,
  deck_id  bigint NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  at       timestamptz NOT NULL DEFAULT now(),
  action   text NOT NULL,     -- created | cloned | built | unbuilt
  detail   text
);

CREATE INDEX IF NOT EXISTS deck_events_deck_idx ON deck_events (deck_id, at DESC);
