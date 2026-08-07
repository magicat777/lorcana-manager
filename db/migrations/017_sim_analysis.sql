-- Teacher analysis attached to a simulation run: how the losses look
-- next to the wins, plus a decision-by-decision replay of one typical
-- loss (deterministic — the game re-drives from its recorded seed).
-- Requested per-run; null when the run didn't ask for it.
-- ("analyze" alone is a reserved word in postgres.)
ALTER TABLE sim_deck_runs ADD COLUMN IF NOT EXISTS analyze_requested boolean NOT NULL DEFAULT false;
ALTER TABLE sim_deck_runs ADD COLUMN IF NOT EXISTS analysis jsonb;
