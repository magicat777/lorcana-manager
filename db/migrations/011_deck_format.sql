-- Sealed/limited support. Lorcana limited rules: deck is MINIMUM 40 cards and
-- the constructed restrictions (max 4 copies, max 2 inks) do not apply — the
-- card pool you opened is the limit. Sealed decks therefore build from their
-- own deck_pool (packs opened at the event/league, grows weekly), never from
-- the collection, and are excluded from in_use copy allocation.
ALTER TABLE decks ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'constructed';

DO $$ BEGIN
  ALTER TABLE decks ADD CONSTRAINT decks_format_check
    CHECK (format IN ('constructed', 'sealed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS deck_pool (
  deck_id  bigint NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id  text   NOT NULL REFERENCES cards(id),
  qty      int    NOT NULL CHECK (qty > 0),
  PRIMARY KEY (deck_id, card_id)
);
