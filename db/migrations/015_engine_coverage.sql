-- Which printings the simulator can play faithfully, published by the
-- engine (Lorcana-Sim tools/export_coverage.py). Deck building reads
-- this so a scouting deck can be built simulatable-by-construction
-- instead of failing at run time.
CREATE TABLE IF NOT EXISTS engine_coverage (
  card_id       text PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  engine_build  text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
