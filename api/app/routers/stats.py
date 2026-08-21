from fastapi import APIRouter

from .. import db

router = APIRouter()


@router.get("/stats")
def totals():
    row = db.query_one(
        """SELECT count(*) FILTER (WHERE col.qty_normal + col.qty_foil > 0) AS unique_owned,
                  COALESCE(sum(col.qty_normal), 0) AS total_normal,
                  COALESCE(sum(col.qty_foil), 0) AS total_foil,
                  COALESCE(sum(col.qty_normal * c.price_usd), 0)::numeric(12,2) AS value_normal,
                  COALESCE(sum(col.qty_foil * c.price_usd_foil), 0)::numeric(12,2) AS value_foil
           FROM collection col JOIN cards c ON c.id = col.card_id"""
    )
    catalog = db.query_one("SELECT count(*) AS n FROM cards")
    row["catalog_cards"] = catalog["n"]
    row["value_total"] = float(row["value_normal"]) + float(row["value_foil"])
    return row


@router.get("/stats/sets")
def per_set():
    return db.query(
        """SELECT s.code, s.name, s.released_at,
                  count(c.id) AS cards_in_set,
                  count(c.id) FILTER (WHERE COALESCE(col.qty_normal,0)+COALESCE(col.qty_foil,0) > 0) AS unique_owned,
                  -- Base set = the printed N/XXX range: standard rarities only.
                  -- Enchanted/Epic/Iconic are chase variants above the printed
                  -- denominator; counting them deflated completion vs reality.
                  count(c.id) FILTER (WHERE c.rarity NOT IN ('Enchanted','Epic','Iconic')) AS base_in_set,
                  count(c.id) FILTER (WHERE c.rarity NOT IN ('Enchanted','Epic','Iconic')
                    AND COALESCE(col.qty_normal,0)+COALESCE(col.qty_foil,0) > 0) AS base_owned,
                  -- Foil completion: own the foil of each base-set card.
                  count(c.id) FILTER (WHERE c.rarity NOT IN ('Enchanted','Epic','Iconic')
                    AND COALESCE(col.qty_foil,0) > 0) AS base_foil_owned,
                  count(c.id) FILTER (WHERE COALESCE(col.qty_normal,0)+COALESCE(col.qty_foil,0) >= 4) AS playsets,
                  COALESCE(sum(col.qty_normal + col.qty_foil), 0) AS total_qty,
                  COALESCE(sum(col.qty_normal * c.price_usd + col.qty_foil * c.price_usd_foil), 0)::numeric(12,2) AS value
           FROM sets s
           JOIN cards c ON c.set_id = s.id
           LEFT JOIN collection col ON col.card_id = c.id
           GROUP BY s.id
           ORDER BY s.released_at, s.code"""
    )


@router.get("/stats/snapshots")
def snapshot_history(days: int = 400):
    """Collection snapshots (daily cron + one per import), oldest first.
    Each row carries the full breakdown JSONB — the frontend picks the
    dimension/metric client-side so switching dropdowns costs no round-trip."""
    return db.query(
        """SELECT cs.id, cs.captured_at, cs.source, cs.import_id,
                  cs.total_cards, cs.unique_cards, cs.value_usd, cs.breakdown,
                  i.note AS import_note, i.filename AS import_filename
           FROM collection_snapshots cs
           LEFT JOIN imports i ON i.id = cs.import_id
           WHERE cs.captured_at >= now() - make_interval(days => %s)
           ORDER BY cs.captured_at""",
        (min(days, 3650),),
    )


@router.get("/stats/value-history")
def value_history():
    """Collection value at each daily price snapshot — today's quantities at
    historical prices (a holdings-value series, not a cash-flow history)."""
    return db.query(
        """WITH daily AS (
             SELECT DISTINCT ON (ph.card_id, date_trunc('day', ph.captured_at))
                    date_trunc('day', ph.captured_at)::date AS day,
                    ph.card_id, ph.usd, ph.usd_foil
             FROM price_history ph
             ORDER BY ph.card_id, date_trunc('day', ph.captured_at), ph.captured_at DESC)
           SELECT d.day,
                  sum(col.qty_normal * COALESCE(d.usd, 0)
                      + col.qty_foil * COALESCE(d.usd_foil, 0))::numeric(12,2) AS value,
                  count(*) AS cards_priced
           FROM daily d
           JOIN collection col ON col.card_id = d.card_id
           WHERE col.qty_normal + col.qty_foil > 0
           GROUP BY d.day ORDER BY d.day""")


@router.get("/stats/movers")
def movers(days: int = 30, limit: int = 10):
    """Top owned-card price gainers/losers: latest snapshot vs the latest one
    at least `days` old (or the oldest available while history is short)."""
    rows = db.query(
        """WITH cur AS (
             SELECT DISTINCT ON (card_id) card_id, usd
             FROM price_history ORDER BY card_id, captured_at DESC),
           prev AS (
             SELECT DISTINCT ON (card_id) card_id, usd
             FROM price_history
             WHERE captured_at <= now() - make_interval(days => %s)
             ORDER BY card_id, captured_at DESC),
           oldest AS (
             SELECT DISTINCT ON (card_id) card_id, usd
             FROM price_history ORDER BY card_id, captured_at ASC)
           SELECT c.full_name, s.code AS set_code, c.collector_number,
                  cur.usd AS price_now,
                  COALESCE(prev.usd, oldest.usd) AS price_then,
                  (cur.usd - COALESCE(prev.usd, oldest.usd)) AS delta
           FROM cur
           JOIN oldest ON oldest.card_id = cur.card_id
           LEFT JOIN prev ON prev.card_id = cur.card_id
           JOIN collection col ON col.card_id = cur.card_id
             AND col.qty_normal + col.qty_foil > 0
           JOIN cards c ON c.id = cur.card_id
           JOIN sets s ON s.id = c.set_id
           WHERE cur.usd IS NOT NULL AND COALESCE(prev.usd, oldest.usd) IS NOT NULL
             AND cur.usd <> COALESCE(prev.usd, oldest.usd)""",
        (days,))
    rows.sort(key=lambda r: float(r["delta"]))
    return {
        "days": days,
        "losers": [r for r in rows if float(r["delta"]) < 0][:limit],
        "gainers": [r for r in reversed(rows) if float(r["delta"]) > 0][:limit],
    }


@router.get("/missing")
def missing(set: str, limit: int = 250):
    return db.query(
        """SELECT c.full_name, c.collector_number, c.rarity, c.ink, c.price_usd
           FROM cards c
           JOIN sets s ON s.id = c.set_id
           LEFT JOIN collection col ON col.card_id = c.id
           WHERE s.code = %s AND COALESCE(col.qty_normal,0)+COALESCE(col.qty_foil,0) = 0
           ORDER BY NULLIF(regexp_replace(c.collector_number,'\\D','','g'),'')::int NULLS LAST
           LIMIT %s""",
        (set, min(limit, 1000)),
    )
