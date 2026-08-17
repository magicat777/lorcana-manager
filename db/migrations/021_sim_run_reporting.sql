-- Reporting fields for per-deck sim runs.
--
-- The calibration test (2026-08-16) showed the published win rate swings
-- 100% -> 62% -> 50% purely with the OPPONENT's pilot, so which pilot
-- each side used has to travel with the result or the number is
-- uninterpretable. It also showed absolute win rates are not predictive
-- while PAIRED deltas still are — and a paired delta needs per-game
-- outcomes, because two runs can share a win rate while disagreeing on
-- every single game.
--
-- outcomes: one char per game in deterministic (seat, seed) order,
--   'W'/'L' from the deck's perspective. ~200 bytes at our sizes.
-- require_build: refuse to run unless the worker is this engine build,
--   so both arms of a comparison are guaranteed to share rules code.
ALTER TABLE sim_deck_runs
  ADD COLUMN IF NOT EXISTS opponent_policy text,
  ADD COLUMN IF NOT EXISTS outcomes        text,
  ADD COLUMN IF NOT EXISTS require_build   text;
