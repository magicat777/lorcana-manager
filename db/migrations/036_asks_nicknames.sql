-- Ask-side price feed + card nickname registry (2026-09-08). Idempotent.
--
-- ask_history: nightly rows from TCGplayer's public mpapi pricepoints
-- endpoint (jobs/fetch_asks.py) for owned + want-list cards — market price
-- plus LISTED MEDIAN ASK per finish. The ask is the second source the
-- outlier/divergence work wanted: ask far under market = market price
-- stale-high (ask_gap flags at <0.7x). Undocumented endpoint — if it starts
-- 403-ing, remove the job per the news-source rule, don't add auth tricks.
--
-- card_nicknames: agent-writable shorthand ("HAM" -> a printing) so
-- Desktop/coaching agents skip search round-trips. Registered via the
-- lorcana_nickname MCP tool; nicks are stored uppercase.

CREATE TABLE IF NOT EXISTS ask_history (
  card_id       text NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  market_normal numeric(10,2),
  ask_normal    numeric(10,2),   -- listedMedianPrice, Normal printing
  market_foil   numeric(10,2),
  ask_foil      numeric(10,2),
  fetched_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ask_history_card_idx
  ON ask_history (card_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS card_nicknames (
  nick        text PRIMARY KEY CHECK (nick = upper(nick)),
  card_id     text NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
