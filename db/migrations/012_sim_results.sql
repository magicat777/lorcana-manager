-- Overnight engine-sim aggregates, POSTed nightly by the lorcana-sim
-- CronJob (Lorcana-Sim repo, deploy/sim-nightly-cronjob.yaml). One row
-- per matchup per run; rows from the same POST share run_at (single
-- transaction), which is how the brief picks "the latest batch".
CREATE TABLE IF NOT EXISTS sim_results (
  id            bigserial PRIMARY KEY,
  run_at        timestamptz NOT NULL DEFAULT now(),
  engine_build  text NOT NULL,           -- image tag, e.g. engine-20260806b
  seed_base     bigint,                  -- date-derived; games reproducible from it
  matchup       text NOT NULL,           -- deckA:deckB[+policyA:policyB]
  games         integer NOT NULL,
  p0_wins       integer NOT NULL,
  p1_wins       integer NOT NULL,
  avg_turns     numeric(6,1),
  avg_branching numeric(6,1),
  ms_per_game   numeric(8,1)
);

CREATE INDEX IF NOT EXISTS sim_results_run_at_idx ON sim_results (run_at DESC);
