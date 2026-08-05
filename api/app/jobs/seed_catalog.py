"""Seed/refresh the full card catalog from Lorcast. Idempotent; rerun on new set releases."""
import sys

import httpx
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .. import config
from . import lorcast


def upsert_set(cur, s: dict) -> None:
    code = s["code"]
    set_num = int(code) if code.isdigit() else None
    cur.execute(
        """INSERT INTO sets (id, code, set_num, name, released_at, raw)
           VALUES (%s,%s,%s,%s,%s,%s)
           ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code, set_num=EXCLUDED.set_num,
             name=EXCLUDED.name, released_at=EXCLUDED.released_at, raw=EXCLUDED.raw,
             updated_at=now()""",
        (s["id"], code, set_num, s["name"], s.get("released_at"), Jsonb(s)),
    )
    # auto-aliases: code, numeric form, lowercased name (hand rows live in set_aliases too)
    aliases = {code.lower(), s["name"].lower()}
    if set_num is not None:
        aliases.add(str(set_num))
    for a in aliases:
        cur.execute(
            """INSERT INTO set_aliases (alias, set_id) VALUES (%s,%s)
               ON CONFLICT (alias) DO UPDATE SET set_id=EXCLUDED.set_id""",
            (a, s["id"]),
        )


def upsert_card(cur, c: dict) -> None:
    imgs = (c.get("image_uris") or {}).get("digital") or {}
    prices = c.get("prices") or {}
    inks = c.get("inks") or ([c["ink"]] if c.get("ink") else None)
    cur.execute(
        """INSERT INTO cards (id, set_id, collector_number, name, version, ink, inks, cost,
             inkwell, type, classifications, keywords, body_text, flavor_text, strength,
             willpower, lore, move_cost, rarity, illustrators, lang, layout, released_at,
             tcgplayer_id, image_small, image_normal, image_large, legalities,
             price_usd, price_usd_foil, prices_updated_at, raw)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                   %s,%s,%s,%s,%s,%s,%s,now(),%s)
           ON CONFLICT (id) DO UPDATE SET
             set_id=EXCLUDED.set_id, collector_number=EXCLUDED.collector_number,
             name=EXCLUDED.name, version=EXCLUDED.version, ink=EXCLUDED.ink,
             inks=EXCLUDED.inks,
             cost=EXCLUDED.cost, inkwell=EXCLUDED.inkwell, type=EXCLUDED.type,
             classifications=EXCLUDED.classifications, keywords=EXCLUDED.keywords,
             body_text=EXCLUDED.body_text, flavor_text=EXCLUDED.flavor_text,
             strength=EXCLUDED.strength, willpower=EXCLUDED.willpower, lore=EXCLUDED.lore,
             move_cost=EXCLUDED.move_cost, rarity=EXCLUDED.rarity,
             illustrators=EXCLUDED.illustrators, lang=EXCLUDED.lang, layout=EXCLUDED.layout,
             released_at=EXCLUDED.released_at, tcgplayer_id=EXCLUDED.tcgplayer_id,
             image_small=EXCLUDED.image_small, image_normal=EXCLUDED.image_normal,
             image_large=EXCLUDED.image_large, legalities=EXCLUDED.legalities,
             price_usd=EXCLUDED.price_usd, price_usd_foil=EXCLUDED.price_usd_foil,
             prices_updated_at=now(), raw=EXCLUDED.raw, updated_at=now()""",
        (
            c["id"], c["set"]["id"], c["collector_number"], c["name"], c.get("version"),
            c.get("ink"), inks, c.get("cost"), c.get("inkwell"), c.get("type"),
            c.get("classifications"), c.get("keywords"), c.get("text"),
            c.get("flavor_text"), c.get("strength"), c.get("willpower"), c.get("lore"),
            c.get("move_cost"), c.get("rarity"), c.get("illustrators"), c.get("lang"),
            c.get("layout"), c.get("released_at"), c.get("tcgplayer_id"),
            imgs.get("small"), imgs.get("normal"), imgs.get("large"),
            Jsonb(c.get("legalities")), prices.get("usd"), prices.get("usd_foil"),
            Jsonb(c),
        ),
    )


def main() -> int:
    with psycopg.connect(config.DATABASE_URL, row_factory=dict_row) as conn, \
         httpx.Client(timeout=30) as client:
        sets = lorcast.fetch_sets(client)
        print(f"lorcast: {len(sets)} sets", flush=True)
        with conn.cursor() as cur:
            for s in sets:
                upsert_set(cur, s)
        conn.commit()

        total = 0
        for s in sets:
            cards = lorcast.fetch_set_cards(client, s["code"])
            with conn.cursor() as cur:
                for c in cards:
                    upsert_card(cur, c)
            conn.commit()
            total += len(cards)
            print(f"  set {s['code']:>4} ({s['name']}): {len(cards)} cards", flush=True)
        print(f"done: {total} cards upserted", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
