from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .. import db
from ..services.matching import norm_number

router = APIRouter()


def slabbed_count_sql(col: str) -> str:
    """Copies of `col` in the grading pipeline and OUT of the player pool.
    One definition — cards.py and decks.py both build availability from it."""
    return ("COALESCE((SELECT count(*) FROM graded_copies g WHERE g.card_id = "
            f"{col} AND g.status IN ('submitted','graded')), 0)")


def find_card_printings(name: str) -> list[dict]:
    """All printings matching a card name, standard rarities first, newest
    first — the single disambiguation heuristic shared by want lists and
    grading (callers decide what to do with multiple hits)."""
    return db.query(
        """SELECT c.id, c.full_name, s.code AS set_code, c.collector_number, c.rarity
           FROM cards c JOIN sets s ON s.id = c.set_id
           WHERE lower(c.full_name) = lower(%s) OR lower(c.name) = lower(%s)
           ORDER BY (c.rarity IN ('Enchanted','Epic','Iconic')),
                    s.released_at DESC NULLS LAST""",
        (name.strip(), name.strip()))


CARD_COLS = """c.id, c.set_id, s.code AS set_code, s.name AS set_name, s.core_legal, c.collector_number,
  c.name, c.version, c.full_name, c.ink, c.inks, c.cost, c.inkwell, c.type, c.classifications,
  c.keywords, c.body_text, c.flavor_text, c.strength, c.willpower, c.lore, c.move_cost,
  c.rarity, c.image_small, c.image_normal, c.image_large, c.price_usd, c.price_usd_foil,
  COALESCE(col.qty_normal, 0) AS qty_normal, COALESCE(col.qty_foil, 0) AS qty_foil,
  COALESCE((SELECT sum(dc.qty) FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
            WHERE dc.card_id = c.id AND d.in_use
              AND d.format = 'constructed'), 0) AS qty_in_use,
  {slabbed} AS qty_slabbed,
  (ec.card_id IS NOT NULL) AS sim_playable""".format(slabbed=slabbed_count_sql("c.id"))

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
    # Slabbed/submitted copies are collector assets, not player assets —
    # they never count toward deck-building availability.
    row["qty_free"] = max(0, row["qty_normal"] + row["qty_foil"]
                          - row["qty_in_use"] - row["qty_slabbed"])
    row["graded"] = db.query(
        """SELECT id, foil, status, grader, cert_id, grade, declared_value,
                  submitted_at, graded_at, notes
           FROM graded_copies WHERE card_id = %s ORDER BY id""", (row["id"],))
    row["price_history"] = db.query(
        """SELECT captured_at, usd, usd_foil FROM price_history
           WHERE card_id = %s ORDER BY captured_at""",
        (row["id"],),
    )
    return row


# --- collector grading lifecycle ---------------------------------------------

GRADE_STATUSES = ("raw", "submitted", "graded")


class GradedIn(BaseModel):
    card_id: str = ""
    card: str = ""                     # name lookup alternative
    foil: bool = False
    status: str = "raw"
    grader: str = ""
    cert_id: str = ""
    grade: str = ""
    declared_value: float | None = None
    notes: str = ""


class GradedUpdate(BaseModel):
    status: str | None = None
    foil: bool | None = None
    grader: str | None = None
    cert_id: str | None = None
    grade: str | None = None
    declared_value: float | None = None
    notes: str | None = None


@router.get("/graded")
def list_graded():
    """The grading portfolio: every tracked copy with lifecycle status, cert,
    grade, and declared vs current market value."""
    rows = db.query(
        """SELECT g.*, c.full_name, s.code AS set_code, c.collector_number,
                  c.rarity, c.price_usd, c.price_usd_foil
           FROM graded_copies g
           JOIN cards c ON c.id = g.card_id JOIN sets s ON s.id = c.set_id
           ORDER BY g.status DESC, g.id""")
    for r in rows:
        market = r["price_usd_foil"] if r["foil"] else r["price_usd"]
        r["market_value"] = float(market) if market is not None else None
    return {
        "copies": rows,
        "by_status": {s: sum(1 for r in rows if r["status"] == s) for s in GRADE_STATUSES},
        "declared_total": round(sum(float(r["declared_value"] or 0) for r in rows), 2),
    }


@router.post("/graded", status_code=201)
def add_graded(body: GradedIn):
    if body.status not in GRADE_STATUSES:
        raise HTTPException(422, f"status must be one of {GRADE_STATUSES}")
    card_id, resolved, other_printings = body.card_id, None, []
    if not card_id:
        if not body.card.strip():
            raise HTTPException(422, "provide card_id or card")
        hits = find_card_printings(body.card)
        if not hits:
            raise HTTPException(422, f"no card named {body.card!r}")
        # Collectors often slab premium printings — never resolve silently:
        # take the standard print but ECHO the choice and the alternates so
        # the caller can correct with an explicit card_id.
        card_id = hits[0]["id"]
        resolved = hits[0]
        other_printings = hits[1:]
    owned = db.query_one(
        "SELECT COALESCE(qty_normal,0) AS n, COALESCE(qty_foil,0) AS f "
        "FROM collection WHERE card_id=%s", (card_id,)) or {"n": 0, "f": 0}
    have = owned["f"] if body.foil else owned["n"]
    tracked = db.query_one(
        "SELECT count(*) AS n FROM graded_copies WHERE card_id=%s AND foil=%s",
        (card_id, body.foil))["n"]
    if tracked + 1 > have:
        finish = "foil" if body.foil else "normal"
        raise HTTPException(
            422, f"collection has {have} {finish} cop{'y' if have == 1 else 'ies'} of this "
                 f"card and {tracked} already tracked for grading — scan/adjust the "
                 "collection count first")
    row = db.query_one(
        """INSERT INTO graded_copies
             (card_id, foil, status, grader, cert_id, grade, declared_value,
              submitted_at, graded_at, notes)
           VALUES (%s,%s,%s,%s,%s,%s,%s,
                   CASE WHEN %s IN ('submitted','graded') THEN CURRENT_DATE END,
                   CASE WHEN %s = 'graded' THEN CURRENT_DATE END, %s)
           RETURNING id""",
        (card_id, body.foil, body.status, body.grader or None, body.cert_id or None,
         body.grade or None, body.declared_value, body.status, body.status,
         body.notes or None))
    return {"id": row["id"], "card_id": card_id, "status": body.status,
            "resolved": resolved, "other_printings": other_printings}


@router.put("/graded/{copy_id}")
def update_graded(copy_id: int, body: GradedUpdate):
    """Advance the lifecycle (raw -> submitted -> graded) or fill in cert/
    grade/value. Timestamps stamp automatically on status transitions."""
    if body.status is not None and body.status not in GRADE_STATUSES:
        raise HTTPException(422, f"status must be one of {GRADE_STATUSES}")
    sets, params = ["updated_at=now()"], []
    for field in ("status", "foil", "grader", "cert_id", "grade", "declared_value", "notes"):
        v = getattr(body, field)
        if v is not None:
            if field == "declared_value" and v < 0:
                v = None               # floats can't use the ''-clears trick
            sets.append(f"{field}=%s")
            params.append(v if v != "" else None)
    # Timestamps track the CURRENT status truthfully in both directions:
    # forward transitions stamp, regressions clear what no longer holds.
    if body.status == "submitted":
        sets.append("submitted_at=COALESCE(submitted_at, CURRENT_DATE)")
        sets.append("graded_at=NULL")
    elif body.status == "graded":
        sets.append("submitted_at=COALESCE(submitted_at, CURRENT_DATE)")
        sets.append("graded_at=COALESCE(graded_at, CURRENT_DATE)")
    elif body.status == "raw":
        sets.append("submitted_at=NULL")
        sets.append("graded_at=NULL")
    row = db.query_one(
        f"UPDATE graded_copies SET {', '.join(sets)} WHERE id=%s RETURNING *",
        params + [copy_id])
    if not row:
        raise HTTPException(404, "no such graded copy")
    return row


@router.delete("/graded/{copy_id}", status_code=204)
def delete_graded(copy_id: int):
    """Remove a copy from the grading pipeline (cracked the slab, sold it, or
    tracked by mistake) — it returns to deck-building availability."""
    if db.execute("DELETE FROM graded_copies WHERE id=%s", (copy_id,)) == 0:
        raise HTTPException(404, "no such graded copy")
