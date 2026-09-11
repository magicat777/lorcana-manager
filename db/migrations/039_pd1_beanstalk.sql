-- PD1/17 "The Beanstalk - Onward and Upward" (2026-09-11, addendum to the
-- P4 handoff doc). A Set-14-era promo Jason holds (sealed wrapper, likely
-- Gen Con 2026): Lorcast's PD1 stops at 8 cards, no catalog lists #17, and
-- the BASE card is unreleased — so this row is seeded from the card face.
--
-- base_card_id stays NULL deliberately. Mig 038's backfill UPDATE re-runs
-- on every apply.sh, so when the Set 14 seed lands the base printing, the
-- link (and group buildability) attaches automatically — no edit needed
-- here unless the name match is ambiguous.
--
-- Face-unknowns, to verify when the base card is published: lore (none
-- visible per the handoff — may genuinely be no-lore), inkwell (not
-- captured on the handoff's field list — NULL, not guessed), price/image
-- (no catalog carries them yet). {S} is the strength glyph convention our
-- Lorcast-sourced body_texts use. Idempotent.

INSERT INTO cards (id, set_id, collector_number, name, version, ink, inks,
                   cost, inkwell, type, willpower, lore, move_cost, rarity,
                   body_text, illustrators, base_card_id, raw, updated_at)
SELECT 'odin_pd1_17', s.id, '17', 'The Beanstalk', 'Onward and Upward',
       'Emerald', ARRAY['Emerald'], 1, NULL, ARRAY['Location'],
       6, NULL, 1, 'Promo',
       'THE DISTANT REACHES Characters get +1 {S} and gain Evasive while here. (Only characters with Evasive can challenge them.)',
       ARRAY['Alyssa Lee'], NULL,
       '{"origin": "odin-local", "reason": "seeded from card face 2026-09-11; no catalog lists PD1/17", "provenance": "unconfirmed, likely Gen Con 2026"}'::jsonb,
       now()
FROM sets s WHERE s.code = 'PD1'
ON CONFLICT (id) DO NOTHING;

INSERT INTO collection (card_id, qty_normal, qty_foil)
VALUES ('odin_pd1_17', 1, 0)
ON CONFLICT (card_id) DO NOTHING;

INSERT INTO collection_log (card_id, source, before_normal, before_foil,
                            after_normal, after_foil)
SELECT 'odin_pd1_17', 'api', 0, 0, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM collection_log WHERE card_id = 'odin_pd1_17');
