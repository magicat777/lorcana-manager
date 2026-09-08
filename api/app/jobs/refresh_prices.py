"""Nightly price refresh: updates prices (and raw) only, no schema-wide churn.

Outlier guard (2026-09-08): each finish's new tick is checked against its
trailing 7-day median and 30-day liquidity. A suspect tick is still WRITTEN
to price_history (raw value, append-only truth) but flagged
suspect_normal/suspect_foil, and does NOT update cards.price_usd* — the
"current price" keeps its last accepted value. The rule tiers and the
two-night confirmation for big-ticket moves live in _suspect() below.

Needs >=3 prior obs in the 7d window; new cards pass unchecked. Flagged
ticks surface on the Grafana data-quality panel — visible, never silently
dropped."""
import sys

import httpx
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .. import config
from . import lorcast


def _suspect(new, med, n_obs, mv, last_val=None, last_sus=False) -> bool:
    """Three tiers + a confirmation rule (2026-09-08 round 2):
    - hard (>10x / <0.1x): always suspect, never confirmable — a persistent
      product-remap artifact stays quarantined until the 7d median self-heals
    - illiquid (>2.5x / <0.4x while <15 moves/30): one weird listing on a
      thin market
    - high-value (>±20% while 7d median > $100): big-ticket cards get held
      ONE night — if the next night's tick agrees within 15%, the move is
      real (two consecutive nights confirm) and it's accepted; the first
      night's tick stays flagged in history as the record of the hold."""
    if new is None or med is None or n_obs < 3 or float(med) <= 0:
        return False
    new_f, med_f = float(new), float(med)
    r = new_f / med_f
    if r > 10 or r < 0.1:
        return True
    moderate = ((r > 2.5 or r < 0.4) and mv < 15) \
        or ((r > 1.2 or r < 0.83) and med_f > 100)
    if moderate and last_sus and last_val \
            and abs(new_f / float(last_val) - 1) <= 0.15:
        return False
    return moderate


def _stats(conn) -> dict:
    """Per card: 7d medians + obs counts (suspects excluded) and 30d
    nights-moved per finish, in two bulk queries."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT card_id,
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY usd)
                        FILTER (WHERE NOT suspect_normal) AS med_n,
                      count(usd) FILTER (WHERE NOT suspect_normal) AS n_n,
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY usd_foil)
                        FILTER (WHERE NOT suspect_foil) AS med_f,
                      count(usd_foil) FILTER (WHERE NOT suspect_foil) AS n_f
               FROM price_history
               WHERE captured_at > now() - interval '7 days'
               GROUP BY card_id""")
        stats = {r["card_id"]: dict(r, mv_n=0, mv_f=0) for r in cur.fetchall()}
        cur.execute(
            """SELECT card_id,
                      count(*) FILTER (WHERE usd IS DISTINCT FROM p_usd) AS mv_n,
                      count(*) FILTER (WHERE usd_foil IS DISTINCT FROM p_f) AS mv_f
               FROM (SELECT card_id, usd, usd_foil,
                            lag(usd) OVER w AS p_usd, lag(usd_foil) OVER w AS p_f,
                            row_number() OVER w AS rn
                     FROM price_history
                     WHERE captured_at > now() - interval '30 days'
                     WINDOW w AS (PARTITION BY card_id ORDER BY captured_at)) x
               WHERE rn > 1 GROUP BY card_id""")
        for r in cur.fetchall():
            if r["card_id"] in stats:
                stats[r["card_id"]].update(mv_n=r["mv_n"], mv_f=r["mv_f"])
        # last tick + its flags per card (the two-night confirmation rule)
        cur.execute(
            """SELECT DISTINCT ON (card_id) card_id,
                      usd AS last_n, usd_foil AS last_f,
                      suspect_normal AS lsus_n, suspect_foil AS lsus_f
               FROM price_history ORDER BY card_id, captured_at DESC""")
        for r in cur.fetchall():
            if r["card_id"] in stats:
                stats[r["card_id"]].update(last_n=r["last_n"], last_f=r["last_f"],
                                           lsus_n=r["lsus_n"], lsus_f=r["lsus_f"])
    return stats


def main() -> int:
    updated = flagged = 0
    with psycopg.connect(config.DATABASE_URL, row_factory=dict_row) as conn, \
         httpx.Client(timeout=30) as client:
        stats = _stats(conn)
        sets = lorcast.fetch_sets(client)
        for s in sets:
            cards = lorcast.fetch_set_cards(client, s["code"])
            with conn.cursor() as cur:
                for c in cards:
                    prices = c.get("prices") or {}
                    usd, usd_f = prices.get("usd"), prices.get("usd_foil")
                    st = stats.get(c["id"], {})
                    sn = _suspect(usd, st.get("med_n"), st.get("n_n", 0), st.get("mv_n", 0),
                                  st.get("last_n"), st.get("lsus_n", False))
                    sf = _suspect(usd_f, st.get("med_f"), st.get("n_f", 0), st.get("mv_f", 0),
                                  st.get("last_f"), st.get("lsus_f", False))
                    if sn or sf:
                        flagged += 1
                        which = " ".join(w for w, b in (("normal", sn), ("foil", sf)) if b)
                        print(f"  [FLAG] {c.get('name')} {s['code']}/{c.get('collector_number')}"
                              f" {which}: usd={usd} foil={usd_f} vs 7d med"
                              f" {st.get('med_n')}/{st.get('med_f')}", flush=True)
                    cur.execute(
                        """UPDATE cards SET
                             price_usd = CASE WHEN %(sn)s THEN price_usd ELSE %(usd)s END,
                             price_usd_foil = CASE WHEN %(sf)s THEN price_usd_foil ELSE %(usd_f)s END,
                             legalities = %(leg)s, prices_updated_at = now(),
                             raw = %(raw)s, updated_at = now()
                           WHERE id = %(id)s""",
                        {"sn": sn, "sf": sf, "usd": usd, "usd_f": usd_f,
                         "leg": Jsonb(c.get("legalities")), "raw": Jsonb(c),
                         "id": c["id"]})
                    updated += cur.rowcount
                    if cur.rowcount:
                        cur.execute(
                            """INSERT INTO price_history
                                 (card_id, usd, usd_foil, suspect_normal, suspect_foil)
                               VALUES (%s, %s, %s, %s, %s)""",
                            (c["id"], usd, usd_f, sn, sf))
            conn.commit()
            print(f"  set {s['code']:>4}: prices updated", flush=True)
    print(f"done: {updated} cards price-refreshed, {flagged} ticks flagged suspect",
          flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
