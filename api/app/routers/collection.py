from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db

router = APIRouter()


class Counts(BaseModel):
    qty_normal: int = Field(ge=0)
    qty_foil: int = Field(ge=0)


@router.put("/collection/{card_id}")
def set_counts(card_id: str, body: Counts, source: str = "webui"):
    if not db.query_one("SELECT 1 FROM cards WHERE id=%s", (card_id,)):
        raise HTTPException(404, "unknown card")
    before = db.query_one(
        "SELECT qty_normal, qty_foil FROM collection WHERE card_id=%s",
        (card_id,)) or {"qty_normal": 0, "qty_foil": 0}
    db.execute(
        """INSERT INTO collection (card_id, qty_normal, qty_foil) VALUES (%s,%s,%s)
           ON CONFLICT (card_id) DO UPDATE
           SET qty_normal=EXCLUDED.qty_normal, qty_foil=EXCLUDED.qty_foil, updated_at=now()""",
        (card_id, body.qty_normal, body.qty_foil),
    )
    # audit trail (mig 037): manual edits were invisible before this
    if (before["qty_normal"], before["qty_foil"]) != (body.qty_normal, body.qty_foil):
        db.execute(
            """INSERT INTO collection_log (card_id, source, before_normal,
                 before_foil, after_normal, after_foil)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (card_id, source if source in ("webui", "mcp", "api") else "api",
             before["qty_normal"], before["qty_foil"],
             body.qty_normal, body.qty_foil))
    return {"card_id": card_id, "qty_normal": body.qty_normal, "qty_foil": body.qty_foil}


@router.get("/collection/{card_id}/log")
def count_log(card_id: str, limit: int = 50):
    """Audit trail for one card's counts, newest first: imports carry the
    filename/note; manual edits carry their source. History reaches back to
    2026-08-04 (first stored import diff); older changes are unrecorded."""
    return db.query(
        """SELECT cl.at, cl.source, cl.import_id,
                  cl.before_normal, cl.before_foil, cl.after_normal, cl.after_foil,
                  i.filename, i.mode, i.note
           FROM collection_log cl
           LEFT JOIN imports i ON i.id = cl.import_id
           WHERE cl.card_id = %s
           ORDER BY cl.at DESC LIMIT %s""",
        (card_id, min(limit, 200)))
