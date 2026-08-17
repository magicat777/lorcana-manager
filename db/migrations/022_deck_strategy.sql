-- Deck strategy/archetype label (aggro, control, ...) shown and edited inline
-- on the deck list table. Free text at the DB layer; the UI offers the common
-- archetypes. Idempotent.
ALTER TABLE decks ADD COLUMN IF NOT EXISTS strategy text;
