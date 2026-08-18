-- Single-game results (1-0 / 0-1) for online play imported from duels.ink,
-- where matches are one game rather than best-of-three. Idempotent
-- (drop+re-add of the same constraint).
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_result_check;
ALTER TABLE matches ADD CONSTRAINT matches_result_check
  CHECK (result IN ('2-0','2-1','1-2','0-2','1-0','0-1','DRAW','BYE'));
