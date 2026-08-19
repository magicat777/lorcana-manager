-- Replay-validation verdicts: the sim engine replays stored duels.ink game
-- logs (public actions) and posts one verdict per game per engine build —
-- every real game becomes a regression test. Divergences carry enough detail
-- to reproduce: [{turn, line, kind: illegal_action|lore_mismatch|unknown_card,
-- detail}]. Re-validating on the same build upserts. Idempotent.

CREATE TABLE IF NOT EXISTS replay_validations (
  id              bigserial PRIMARY KEY,
  log_id          bigint NOT NULL REFERENCES duels_game_logs(id) ON DELETE CASCADE,
  engine_build    text NOT NULL,
  validated_at    timestamptz NOT NULL DEFAULT now(),
  ok              boolean NOT NULL,
  actions_checked integer,
  divergences     jsonb,
  UNIQUE (log_id, engine_build)
);
CREATE INDEX IF NOT EXISTS replay_validations_build_idx
  ON replay_validations (engine_build, ok);
