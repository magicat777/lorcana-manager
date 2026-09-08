-- Outlier flags on the nightly price ticks (2026-09-08). The ingest keeps the
-- RAW value in usd/usd_foil (append-only truth, never rewritten) and marks a
-- finish's tick suspect when it jumps implausibly vs the trailing 7-day
-- median (see jobs/refresh_prices.py for the exact rule). A suspect tick
-- does NOT update cards.price_usd* (the "current price" everywhere), and
-- movers/CI/deltas skip it; the Grafana data-quality panel lists them.
-- Idempotent.

ALTER TABLE price_history ADD COLUMN IF NOT EXISTS suspect_normal boolean NOT NULL DEFAULT false;
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS suspect_foil   boolean NOT NULL DEFAULT false;

-- Retro-flag the known artifact that motivated this: P1/4 Cruella De Vil
-- (foil) dropped $1250 -> $0.25 on 2026-09-05 and stayed there — a 5000x
-- collapse on a promo with no market depth (product-mapping glitch, not a
-- market). Window bounded so a future genuine $0.25 price is unaffected.
UPDATE price_history ph SET suspect_foil = true
FROM cards c JOIN sets s ON s.id = c.set_id
WHERE ph.card_id = c.id AND s.code = 'P1' AND c.collector_number = '4'
  AND ph.captured_at >= DATE '2026-09-05' AND ph.captured_at < DATE '2026-09-09'
  AND ph.usd_foil = 0.25;
