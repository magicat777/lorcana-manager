-- Sim-only decks: opponent lists imported purely to run simulations against
-- (e.g. netdecks from Dreamborn). Not owned, never buildable-checked, never
-- built/wanted — excluded from all collection/allocation logic.
ALTER TABLE decks ADD COLUMN IF NOT EXISTS sim_only boolean NOT NULL DEFAULT false;
