-- Cross-TCG market benchmarks (2026-09-12): how does the Lorcana collection
-- behave vs the broader card-game market? Two honest, automatable layers:
--   sealed: benchmark products per game via TCGplayer mpapi (same source,
--     units, and cadence as our own sealed tracking — like-for-like), and
--   equity: TCG publishers' daily closes via Yahoo's chart JSON (industry
--     shift between companies; Ravensburger is PRIVATE, so Lorcana has no
--     ticker — stated rather than proxied, since Disney's TCG exposure is
--     negligible and would mislead).
-- Basket character (each line is indexed to 100, so absolute price doesn't
-- matter, but drift character does): MTG Foundations is IN-PRINT by design
-- through ~2029 (supply-side signal); Pokemon 151 ETB and OP-01 wave 1 are
-- out-of-print appreciators (collector-side). fetch_asks.py appends one
-- observation per benchmark nightly. Seeds are migration-owned. Idempotent.

CREATE TABLE IF NOT EXISTS market_benchmarks (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('sealed', 'equity')),
  game          text NOT NULL,          -- MTG | Pokemon | One Piece | Lorcana | ...
  label         text UNIQUE NOT NULL,   -- series name on the panel
  tcgplayer_id  int,                    -- sealed kind
  ticker        text,                   -- equity kind (Yahoo symbol)
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS market_benchmark_obs (
  benchmark_id  bigint NOT NULL REFERENCES market_benchmarks(id) ON DELETE CASCADE,
  price         numeric(12,2) NOT NULL,
  observed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_benchmark_obs_idx
  ON market_benchmark_obs (benchmark_id, observed_at DESC);

INSERT INTO market_benchmarks (kind, game, label, tcgplayer_id, ticker) VALUES
  ('sealed', 'MTG',       'MTG Foundations booster box (in print)', 562118, NULL),
  ('sealed', 'Pokemon',   'Pokemon 151 ETB (out of print)',         503313, NULL),
  ('sealed', 'One Piece', 'OP-01 Romance Dawn box (out of print)',  450086, NULL),
  ('sealed', 'Lorcana',   'Lorcana AotV booster box (in print)',    690384, NULL),
  ('equity', 'MTG',       'Hasbro (HAS) — Magic',                   NULL, 'HAS'),
  ('equity', 'Pokemon',   'Nintendo ADR (NTDOY) ~ Pokemon proxy',   NULL, 'NTDOY'),
  ('equity', 'One Piece', 'Bandai Namco (7832.T) — One Piece',      NULL, '7832.T'),
  ('equity', 'Yu-Gi-Oh',  'Konami (9766.T) — Yu-Gi-Oh',             NULL, '9766.T')
ON CONFLICT (label) DO NOTHING;
