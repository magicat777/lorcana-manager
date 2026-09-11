# ODIN handoff — Promo Set 4 (P4) catalog gap

**Date:** 2026-09-11 · **Owner:** Jason · **Scope:** `lorcana-api` catalog + Dreamborn scan sync + deck buildability
**Status of the problem:** Jason holds P4 promos (printed `9/P4`, `10/P4`, `11/P4`, set-13 era). Dreamborn tracks them. Lorcast — ODIN's catalog source — has no `P4` set (it has P1, P2, P3, PD1). ODIN's `collection_stats` therefore cannot show them and the next scan sync has nowhere to land them.

## What we know for certain

| Fact | Evidence |
|---|---|
| Cards carry set code `P4` | Card face: `9/P4 · EN · 13` etc. (screenshot 2026-09-11) |
| Dreamborn has a P4 catalog with prices | Dreamborn UI shows $1.47 / $1.33 / $1.28 with quantity controls |
| Lorcast has no P4 | `GET /v0/sets` lists P1, P2, P3, PD1 only; `/v0/cards/search?q=Morph` returns only 13/57 |
| ODIN catalog = Lorcast mirror | `collection_stats` set list matches Lorcast set list exactly |
| Promos are alt-art reprints | Same name + version + rules as the base card; legal as that card for the 4-copy limit |

## Decision

Extend ODIN's catalog with P4 rows **mirrored from the base printing**, plus a link field to the base card. Do not remap promos onto base printings (breaks collection fidelity), and do not wait on Lorcast (unknown timeline).

## Changes

### 1. Catalog: add set `P4` and seed rows

- Add set: `code=P4`, `name=Promo Set 4`, `released_at=2026-07-17` (Attack of the Vine launch), `type=promo`.
- Add a nullable link on the card table: `base_set_code`, `base_collector_number` (or a single FK to the base card row). Backfill it for existing P1/P2/P3/PD1 rows where name+version match a main-set card — this is what makes rule 3 below work for *all* promos, not just P4.
- Seed the three known P4 cards from `p4_seed.json` (attached). Fields to copy from the base card: name, version, ink(s), cost, inkwell, type, classifications, strength/willpower/lore, move_cost, rules text, illustrator. Set `rarity=Promo`, `collector_number` = the P4 number.
- Prices: leave null. Nightly Lorcast price job should skip rows whose set has no Lorcast counterpart and backfill automatically once Lorcast adds P4 (match on set code + collector number).

### 2. Scan sync: stop dropping unknown printings silently

- On import, any row whose `(set_code, collector_number)` is not in the catalog goes to a **reject list** that is returned in the sync result and logged, with counts per set code.
- Acceptance check for this fix: after the next sync, reject count for `P4` = 0 and `collection_stats` shows `P4: 3/… unique, 4 copies` (Morph ×1, Meilin Lee ×1, Randall Boggs ×2 per Dreamborn on 2026-09-11).

### 3. Deck buildability: count copies by base card

- When computing `own` / `free` for a deck line, sum quantities across the base printing **and every row whose base link points to it** (promos, and Enchanted/Epic/Iconic if those aren't already merged).
- Deck lists keep referencing the base printing; nothing changes in saved decks.
- Acceptance check: a deck running 4× of a card where Jason holds 3 base + 1 P4 promo reports `own 4`, buildable.

### 4. `lorcana_search` / `lorcana_missing`

- `lorcana_missing` for a main set should **not** treat a promo as filling a base-set slot (collection completeness is per printing). No change needed if it already filters by set code.
- `lorcana_search` output: append `(promo of 13/57)` when the row has a base link, so results are self-explanatory.

## Open items for Jason

- P4 holdings as of 2026-09-11: P4/9 Morph ×1, P4/10 Meilin Lee ×1, P4/11 Randall Boggs ×2 (three printings, four copies). Any P4 cards acquired later need their base card identified so rows can be seeded the same way.
- Confirm whether the current sync logs unknown-set rejects at all; if not, item 2 is the first thing to do so the size of the gap is visible.

## Seed data (P4)

| P4 # | Base | Card | Ink | Cost | Base rarity |
|---|---|---|---|---|---|
| 9 | 13/57 | Morph – Little Imitator | Amethyst | 2 | Uncommon |
| 10 | 13/7 | Meilin Lee – Lead Vocalist | Amber | 1 | Uncommon |
| 11 | 13/153 | Randall Boggs – Scary Smart | Sapphire | 4 | Rare |

Full field set for each row is in `p4_seed.json`, pulled from Lorcast's base-printing records on 2026-09-11.
