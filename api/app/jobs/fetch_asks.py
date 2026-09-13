"""Nightly ask-side fetch: TCGplayer's public mpapi pricepoints per card.

Targets owned + want-list cards (manual and deck-derived) that carry a
tcgplayer_id — a bounded set (~700), fetched politely (0.3s spacing, one
GET each). Stores market price and LISTED MEDIAN ASK per finish into
ask_history. The ask is the second price source the market tooling wanted:
median ask well under market (<0.7x) means the sales-weighted market price
is stale-high — surfaced as ask_gap flags on card/holdings/movers, never by
silently altering CI.

mpapi is UNDOCUMENTED (feasibility-probed 2026-09-08: plain unauthenticated
JSON). Same discipline as news sources: if it starts 403-ing or the shape
changes, REMOVE this job rather than adding auth/browser tricks — the loud
failure below makes that visible."""
import sys
import time

import httpx
import psycopg
from psycopg.rows import dict_row

from .. import config

MPAPI = "https://mpapi.tcgplayer.com/v2/product/{tid}/pricepoints"
DELAY_S = 0.3
UA = {"User-Agent": "Mozilla/5.0 (personal collection tracker; ~700 req/day)"}

_TARGETS_SQL = """
SELECT c.id, c.raw->>'tcgplayer_id' AS tid
FROM cards c
WHERE c.raw->>'tcgplayer_id' IS NOT NULL AND c.id IN (
  SELECT card_id FROM collection WHERE qty_normal + qty_foil > 0
  UNION SELECT card_id FROM want_list_cards
  UNION (SELECT dc.card_id FROM deck_cards dc
         JOIN decks d ON d.id = dc.deck_id
           AND d.wanted AND NOT d.in_use AND NOT d.sim_only
           AND d.format = 'constructed'
         LEFT JOIN collection col ON col.card_id = dc.card_id
         GROUP BY dc.card_id, col.qty_normal, col.qty_foil
         HAVING sum(dc.qty) > COALESCE(col.qty_normal,0) + COALESCE(col.qty_foil,0)
         EXCEPT SELECT card_id FROM wantlist_skips))
"""


def main() -> int:
    ok = errors = 0
    with psycopg.connect(config.DATABASE_URL, row_factory=dict_row) as conn, \
         httpx.Client(timeout=20, headers=UA) as client:
        with conn.cursor() as cur:
            cur.execute(_TARGETS_SQL)
            targets = cur.fetchall()
        print(f"fetching asks for {len(targets)} cards", flush=True)
        with conn.cursor() as cur:
            for t in targets:
                time.sleep(DELAY_S)
                try:
                    r = client.get(MPAPI.format(tid=t["tid"]))
                    if r.status_code == 403:
                        print("[LORE] mpapi returned 403 — endpoint is gating "
                              "non-browser clients. REMOVE this job (news-source "
                              "rule), do not add auth tricks.", flush=True)
                        return 1
                    r.raise_for_status()
                    row = {"mn": None, "an": None, "mf": None, "af": None}
                    for p in r.json():
                        if p.get("printingType") == "Normal":
                            row["mn"], row["an"] = p.get("marketPrice"), p.get("listedMedianPrice")
                        elif p.get("printingType") == "Foil":
                            row["mf"], row["af"] = p.get("marketPrice"), p.get("listedMedianPrice")
                    cur.execute(
                        """INSERT INTO ask_history
                             (card_id, market_normal, ask_normal, market_foil, ask_foil)
                           VALUES (%s, %s, %s, %s, %s)""",
                        (t["id"], row["mn"], row["an"], row["mf"], row["af"]))
                    ok += 1
                except Exception as e:  # keep going; one card's failure isn't a run failure
                    errors += 1
                    if errors <= 5:
                        print(f"  error on {t['id']}: {e}", flush=True)
        # Sealed pass (mig 040): SKUs with a tcgplayer_id get a nightly
        # market-price observation — the SP gauge/series move daily instead
        # of only when a price is hand-logged. Same endpoint, same removal
        # rule. SKUs without ids stay manual-only.
        with conn.cursor() as cur:
            cur.execute("""SELECT id, name, tcgplayer_id FROM sealed_products
                           WHERE active AND tcgplayer_id IS NOT NULL""")
            for sp in cur.fetchall():
                time.sleep(DELAY_S)
                try:
                    r = client.get(MPAPI.format(tid=sp["tcgplayer_id"]))
                    r.raise_for_status()
                    mkt = next((p.get("marketPrice") for p in r.json()
                                if p.get("printingType") == "Normal"), None)
                    if mkt is not None and float(mkt) > 0:
                        cur.execute(
                            """INSERT INTO sealed_price_obs (product_id, price, source)
                               VALUES (%s, %s, 'tcgplayer-auto')""",
                            (sp["id"], mkt))
                        print(f"  sealed: {sp['name']} ${mkt}", flush=True)
                except Exception as e:
                    errors += 1
                    print(f"  sealed error on {sp['name']}: {e}", flush=True)
        # Cross-TCG benchmark pass (mig 041): sealed benchmarks via the same
        # mpapi endpoint; publisher equities via Yahoo's chart JSON (keyless;
        # stooq was tried first and is JS-walled). Same removal-over-tricks
        # rule for both. One observation per benchmark per night.
        with conn.cursor() as cur:
            cur.execute("""SELECT id, kind, label, tcgplayer_id, ticker
                           FROM market_benchmarks WHERE active""")
            for b in cur.fetchall():
                time.sleep(DELAY_S)
                try:
                    if b["kind"] == "sealed":
                        r = client.get(MPAPI.format(tid=b["tcgplayer_id"]))
                        r.raise_for_status()
                        price = next((p.get("marketPrice") for p in r.json()
                                      if p.get("printingType") == "Normal"), None)
                    else:
                        r = client.get(
                            "https://query1.finance.yahoo.com/v8/finance/chart/"
                            f"{b['ticker']}?range=1d&interval=1d")
                        r.raise_for_status()
                        price = r.json()["chart"]["result"][0]["meta"].get(
                            "regularMarketPrice")
                    if price is not None and float(price) > 0:
                        cur.execute(
                            """INSERT INTO market_benchmark_obs (benchmark_id, price)
                               VALUES (%s, %s)""", (b["id"], price))
                        print(f"  benchmark: {b['label']} {price}", flush=True)
                except Exception as e:
                    errors += 1
                    print(f"  benchmark error on {b['label']}: {e}", flush=True)
        if targets and errors > len(targets) * 0.2:
            print(f"[LORE] ask fetch failing broadly ({errors}/{len(targets)}) — "
                  "endpoint shape may have changed; investigate or remove the job.",
                  flush=True)
            conn.rollback()
            return 1
        conn.commit()
    print(f"done: {ok} cards ask-fetched, {errors} errors", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
