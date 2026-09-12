-- Sealed SKUs get TCGplayer product ids (2026-09-12): the "no scrapeable
-- sealed source" premise behind hand-logged-only observations died when
-- mpapi proved out — jobs/fetch_asks.py now fetches each id'd SKU's market
-- price nightly into sealed_price_obs (source 'tcgplayer-auto'), so the
-- Grafana sealed-premium gauge moves daily instead of only when Jason
-- pastes a price. Manual logging stays for SKUs without ids (Hyperia City
-- until TCGplayer lists them — ADD THOSE IDS HERE when they appear; this
-- UPDATE re-applies on every apply.sh, migration-owned like MSRPs).

ALTER TABLE sealed_products ADD COLUMN IF NOT EXISTS tcgplayer_id int;

UPDATE sealed_products sp SET tcgplayer_id = v.tid
FROM (VALUES
  ('Fabled Illumineer''s Trove',              645299),
  ('Whispers in the Well Illumineer''s Trove', 652709),
  ('Winterspell Illumineer''s Trove',          664826),
  ('Wilds Unknown Illumineer''s Trove',        678168),
  ('Attack of the Vine! Illumineer''s Trove',  690388),
  ('Attack of the Vine! booster box',          690384)
) AS v(name, tid)
WHERE sp.name = v.name AND sp.tcgplayer_id IS DISTINCT FROM v.tid;
