-- Market-signal tracking: sealed-product prices logged by hand (there is no
-- scrapeable source for sealed; Lorcast prices singles only), so the brief can
-- compute Sealed Premium (market/MSRP) per SKU and compare it against the
-- Competitive Index (price vs 30-day trailing avg, from price_history) of
-- want-list singles. SP diverging from CI = scalped box; CI rising = real
-- play demand. Idempotent.
--
-- MSRPs are seeds: EDIT THEM HERE, not with a manual UPDATE — migrations
-- re-run on every apply.sh, and ON CONFLICT updates msrp back to this file's
-- value.

CREATE TABLE IF NOT EXISTS sealed_products (
  id          bigserial PRIMARY KEY,
  name        text UNIQUE NOT NULL,
  set_code    text,                     -- matches sets.code when set-specific
  kind        text NOT NULL DEFAULT 'other',  -- booster_box | trove | other
  msrp        numeric(10,2) NOT NULL CHECK (msrp > 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sealed_price_obs (
  id          bigserial PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES sealed_products(id) ON DELETE CASCADE,
  price       numeric(10,2) NOT NULL CHECK (price > 0),
  source      text,                     -- store/site the price was seen at
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sealed_price_obs_idx
  ON sealed_price_obs (product_id, observed_at DESC);

-- Starter SKUs (the coaching validation set): Set 13 sealed + the Winterspell
-- trove whose 75% premium prompted the signal. Trove MSRP $49.99; a 24-pack
-- booster display at $5.99/pack lists for $143.76.
INSERT INTO sealed_products (name, set_code, kind, msrp) VALUES
  ('Attack of the Vine! booster box',      '13', 'booster_box', 143.76),
  ('Attack of the Vine! Illumineer''s Trove', '13', 'trove',      49.99),
  ('Winterspell Illumineer''s Trove',      '11', 'trove',        49.99)
ON CONFLICT (name) DO UPDATE SET msrp = EXCLUDED.msrp;
