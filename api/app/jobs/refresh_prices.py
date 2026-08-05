"""Weekly price refresh: updates prices (and raw) only, no schema-wide churn."""
import sys

import httpx
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .. import config
from . import lorcast


def main() -> int:
    updated = 0
    with psycopg.connect(config.DATABASE_URL, row_factory=dict_row) as conn, \
         httpx.Client(timeout=30) as client:
        sets = lorcast.fetch_sets(client)
        for s in sets:
            cards = lorcast.fetch_set_cards(client, s["code"])
            with conn.cursor() as cur:
                for c in cards:
                    prices = c.get("prices") or {}
                    cur.execute(
                        """UPDATE cards SET price_usd=%s, price_usd_foil=%s,
                             legalities=%s, prices_updated_at=now(), raw=%s, updated_at=now()
                           WHERE id=%s""",
                        (prices.get("usd"), prices.get("usd_foil"),
                         Jsonb(c.get("legalities")), Jsonb(c), c["id"]),
                    )
                    updated += cur.rowcount
                    if cur.rowcount:
                        cur.execute(
                            "INSERT INTO price_history (card_id, usd, usd_foil) VALUES (%s,%s,%s)",
                            (c["id"], prices.get("usd"), prices.get("usd_foil")),
                        )
            conn.commit()
            print(f"  set {s['code']:>4}: prices updated", flush=True)
    print(f"done: {updated} cards price-refreshed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
