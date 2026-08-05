-- Physical deck allocation: in_use marks a deck as actually built/sleeved from
-- collection cards. Allocated copies = sum of deck_cards.qty across in_use
-- decks; "free" copies = owned minus allocated. Idempotent.

ALTER TABLE decks ADD COLUMN IF NOT EXISTS in_use boolean NOT NULL DEFAULT false;
