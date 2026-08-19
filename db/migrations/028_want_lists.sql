-- Named want lists + item-level control over the deck-derived shopping list.
--
-- want_lists: user-named lists ("Want for Deck #34, Rainbow Hunny", "Foils",
--   "Spec buys"). Optionally linked to a deck — a linked list auto-includes
--   that deck's live shortfall at read time, on top of manual entries.
-- want_list_cards: manual entries per list.
-- wantlist_skips: cards removed from the aggregated deck-derived want list
--   ("already bought it / don't want it") — restorable, survives recompute.
-- Idempotent.

CREATE TABLE IF NOT EXISTS want_lists (
  id          bigserial PRIMARY KEY,
  name        text UNIQUE NOT NULL,
  deck_id     bigint REFERENCES decks(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS want_list_cards (
  list_id  bigint NOT NULL REFERENCES want_lists(id) ON DELETE CASCADE,
  card_id  text NOT NULL REFERENCES cards(id),
  qty      int NOT NULL CHECK (qty > 0),
  PRIMARY KEY (list_id, card_id)
);

CREATE TABLE IF NOT EXISTS wantlist_skips (
  card_id     text PRIMARY KEY REFERENCES cards(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
