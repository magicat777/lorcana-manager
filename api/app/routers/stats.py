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
                  count(c.id) FILTER (WHERE COALESCE(col.qty_normal,0)+COALESCE(col.qty_foil,0) >= 4) AS playsets,
                  COALESCE(sum(col.qty_normal + col.qty_foil), 0) AS total_qty,
                  COALESCE(sum(col.qty_normal * c.price_usd + col.qty_foil * c.price_usd_foil), 0)::numeric(12,2) AS value
           FROM sets s
           JOIN cards c ON c.set_id = s.id
           LEFT JOIN collection col ON col.card_id = c.id
           GROUP BY s.id
           ORDER BY s.released_at, s.code"""
    )


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
