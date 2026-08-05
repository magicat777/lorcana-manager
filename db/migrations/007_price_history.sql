-- Weekly price snapshots (appended by the price-refresh job) so the brief can
-- report movers on owned cards. Idempotent.

CREATE TABLE IF NOT EXISTS price_history (
  card_id      text NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  usd          numeric(10,2),
  usd_foil     numeric(10,2),
  captured_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_history_card_idx ON price_history (card_id, captured_at DESC);
