-- Promo Set 4 + promo→base card links (2026-09-11, per
-- docs/"ODIN_P4_promo_catalog_handoff (1).md"). Lorcast has no P4 set, but
-- Jason holds P4 promos and Dreamborn tracks them — so the catalog gains
-- ODIN-authored rows (ids 'odin_*', never Lorcast 'crd_*') mirrored from
-- their base printings, plus a base_card_id link that makes promos count
-- toward deck buildability (a promo IS the base card for the 4-copy rule).
-- Idempotent; re-runs must not clobber later scan-synced counts.
--
-- If Lorcast later adds P4: their rows would arrive under crd_* ids via the
-- seed job and DUPLICATE these — at that point migrate collection counts to
-- the Lorcast rows and retire the odin_* rows (see §6.6 guide note).

ALTER TABLE cards ADD COLUMN IF NOT EXISTS base_card_id text REFERENCES cards(id);
CREATE INDEX IF NOT EXISTS cards_base_card_idx ON cards (base_card_id)
  WHERE base_card_id IS NOT NULL;

-- Set P4. released_at = Attack of the Vine launch (the P4 wave's era).
INSERT INTO sets (id, code, name, released_at, set_num, core_legal, raw, updated_at)
VALUES ('set_odin_p4', 'P4', 'Promo Set 4', DATE '2026-07-17', NULL, false,
        '{"origin": "odin-local", "reason": "Lorcast has no P4 as of 2026-09-11"}'::jsonb,
        now())
ON CONFLICT (id) DO NOTHING;

-- Dreamborn import labels for the next scan sync.
INSERT INTO set_aliases (alias, set_id) VALUES
  ('p4', 'set_odin_p4'), ('promo set 4', 'set_odin_p4')
ON CONFLICT DO NOTHING;

-- The three known P4 printings, fields mirrored from their base cards
-- (same name/version/rules — alt-art reprints). rarity='Promo'.
INSERT INTO cards (id, set_id, collector_number, name, version, ink, inks,
                   cost, inkwell, type, classifications, keywords, body_text,
                   flavor_text, strength, willpower, lore, move_cost, rarity,
                   image_small, image_normal, image_large, illustrators,
                   released_at, legalities, base_card_id, raw, updated_at)
SELECT v.new_id, 'set_odin_p4', v.num, b.name, b.version, b.ink, b.inks,
       b.cost, b.inkwell, b.type, b.classifications, b.keywords, b.body_text,
       b.flavor_text, b.strength, b.willpower, b.lore, b.move_cost, 'Promo',
       b.image_small, b.image_normal, b.image_large, b.illustrators,
       DATE '2026-07-17', b.legalities, b.id,
       jsonb_build_object('origin', 'odin-local', 'mirrored_from', b.id),
       now()
FROM (VALUES
  ('odin_p4_9',  '9',  '13', '57'),
  ('odin_p4_10', '10', '13', '7'),
  ('odin_p4_11', '11', '13', '153')
) AS v(new_id, num, base_set, base_num)
JOIN sets bs ON bs.code = v.base_set
JOIN cards b ON b.set_id = bs.id AND b.collector_number = v.base_num
ON CONFLICT (id) DO NOTHING;

-- Backfill base links for EXISTING promo-set rows (set_num IS NULL) that
-- match exactly one main-set printing by full name — this is what makes
-- group-counted buildability cover P1/P2/P3/PD1/D23 promos too. Ambiguous
-- names (0 or 2+ main-set matches) stay NULL, deliberately.
UPDATE cards p SET base_card_id = m.base_id
FROM (
  SELECT p2.id AS promo_id,
         (array_agg(b.id))[1] AS base_id
  FROM cards p2
  JOIN sets ps ON ps.id = p2.set_id AND ps.set_num IS NULL
  JOIN cards b ON lower(b.full_name) = lower(p2.full_name) AND b.id <> p2.id
  JOIN sets bsx ON bsx.id = b.set_id AND bsx.set_num IS NOT NULL
  WHERE p2.base_card_id IS NULL
  GROUP BY p2.id
  HAVING count(DISTINCT b.id) = 1
) m
WHERE p.id = m.promo_id AND p.base_card_id IS NULL;

-- Jason's P4 holdings as of the handoff (Morph x1, Meilin x1, Randall x2).
-- ON CONFLICT DO NOTHING: a later Dreamborn replace-scan owns these counts.
INSERT INTO collection (card_id, qty_normal, qty_foil) VALUES
  ('odin_p4_9', 1, 0), ('odin_p4_10', 1, 0), ('odin_p4_11', 2, 0)
ON CONFLICT (card_id) DO NOTHING;

INSERT INTO collection_log (card_id, source, before_normal, before_foil,
                            after_normal, after_foil)
SELECT v.id, 'api', 0, 0, v.n, 0
FROM (VALUES ('odin_p4_9', 1), ('odin_p4_10', 1), ('odin_p4_11', 2)) AS v(id, n)
WHERE NOT EXISTS (SELECT 1 FROM collection_log cl WHERE cl.card_id = v.id);
