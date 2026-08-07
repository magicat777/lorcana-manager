from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..services.matching import norm_number

router = APIRouter()

CARD_COLS = """c.id, c.set_id, s.code AS set_code, s.name AS set_name, s.core_legal, c.collector_number,
  c.name, c.version, c.full_name, c.ink, c.inks, c.cost, c.inkwell, c.type, c.classifications,
  c.keywords, c.body_text, c.flavor_text, c.strength, c.willpower, c.lore, c.move_cost,
  c.rarity, c.image_small, c.image_normal, c.image_large, c.price_usd, c.price_usd_foil,
  COALESCE(col.qty_normal, 0) AS qty_normal, COALESCE(col.qty_foil, 0) AS qty_foil,
  COALESCE((SELECT sum(dc.qty) FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
            WHERE dc.card_id = c.id AND d.in_use
              AND d.format = 'constructed'), 0) AS qty_in_use,
  (ec.card_id IS NOT NULL) AS sim_playable"""

CARD_FROM = """FROM cards c
  JOIN sets s ON s.id = c.set_id
  LEFT JOIN collection col ON col.card_id = c.id
  LEFT JOIN engine_coverage ec ON ec.card_id = c.id"""


@router.get("/sets")
def list_sets():
    return db.query(
        """SELECT s.id, s.code, s.set_num, s.name, s.released_at,
                  count(c.id) AS card_count
           FROM sets s LEFT JOIN cards c ON c.set_id = s.id
           GROUP BY s.id ORDER BY s.released_at, s.code"""
    )


@router.get("/cards")
def search_cards(
    q: str = "",
    set: str = "",
    ink: str = "",
    rarity: str = "",
    type: str = "",
    owned: str = Query("all", pattern="^(all|owned|missing)$"),
    sim: str = Query("all", pattern="^(all|playable|unplayable)$"),
    core: bool = False,
    sort: str = Query("name", pattern="^(set|name|cost|price)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(60, ge=1, le=100),
):
    where, params = [], []
    if q:
        where.append("(c.full_name ILIKE %s OR c.body_text ILIKE %s)")
        params += [f"%{q}%", f"%{q}%"]
    if set:
        where.append("s.code = %s")
        params.append(set)
    if ink:
        where.append("%s = ANY(c.inks)")
        params.append(ink)
    if rarity:
        where.append("c.rarity = %s")
        params.append(rarity)
    if type:
        where.append("%s = ANY(c.type)")
        params.append(type)
    if core:
        where.append("s.core_legal")
    if sim == "playable":
        where.append("ec.card_id IS NOT NULL")
    elif sim == "unplayable":
        where.append("ec.card_id IS NULL")
    if owned == "owned":
        where.append("COALESCE(col.qty_normal,0) + COALESCE(col.qty_foil,0) > 0")
    elif owned == "missing":
        where.append("COALESCE(col.qty_normal,0) + COALESCE(col.qty_foil,0) = 0")
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    order = {
        "set": "s.released_at, s.code, NULLIF(regexp_replace(c.collector_number,'\\D','','g'),'')::int NULLS LAST, c.collector_number",
        "name": "c.full_name",
        "cost": "c.cost NULLS LAST, c.full_name",
        "price": "c.price_usd DESC NULLS LAST",
    }[sort]

    total = db.query_one(f"SELECT count(*) AS n {CARD_FROM} {where_sql}", params)["n"]
    rows = db.query(
        f"SELECT {CARD_COLS} {CARD_FROM} {where_sql} ORDER BY {order} LIMIT %s OFFSET %s",
        params + [page_size, (page - 1) * page_size],
    )
    return {"total": total, "page": page, "page_size": page_size, "results": rows}


@router.get("/cards/{set_code}/{number}")
def card_detail(set_code: str, number: str):
    row = db.query_one(
        f"""SELECT {CARD_COLS}, c.illustrators, c.legalities, c.released_at, c.prices_updated_at
            {CARD_FROM}
            WHERE s.code = %s AND lower(ltrim(c.collector_number, '0')) = %s""",
        [set_code, norm_number(number)],
    )
    if not row:
        raise HTTPException(404, f"no card {set_code}/{number}")
    row["decks"] = db.query(
        """SELECT d.id, d.name, d.in_use, dc.qty
           FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
           WHERE dc.card_id = %s ORDER BY d.in_use DESC, d.name""",
        (row["id"],),
    )
    row["qty_free"] = max(0, row["qty_normal"] + row["qty_foil"] - row["qty_in_use"])
    row["price_history"] = db.query(
        """SELECT captured_at, usd, usd_foil FROM price_history
           WHERE card_id = %s ORDER BY captured_at""",
        (row["id"],),
    )
    return row
