-- Want list: flag constructed decks you intend to build. The global want list
-- aggregates missing copies across wanted decks (on top of copies already
-- allocated to built decks) and prices them — the shop-visit shopping list.
ALTER TABLE decks ADD COLUMN IF NOT EXISTS wanted boolean NOT NULL DEFAULT false;
