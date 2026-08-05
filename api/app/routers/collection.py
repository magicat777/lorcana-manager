from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db

router = APIRouter()


class Counts(BaseModel):
    qty_normal: int = Field(ge=0)
    qty_foil: int = Field(ge=0)


@router.put("/collection/{card_id}")
def set_counts(card_id: str, body: Counts):
    if not db.query_one("SELECT 1 FROM cards WHERE id=%s", (card_id,)):
        raise HTTPException(404, "unknown card")
    db.execute(
        """INSERT INTO collection (card_id, qty_normal, qty_foil) VALUES (%s,%s,%s)
           ON CONFLICT (card_id) DO UPDATE
           SET qty_normal=EXCLUDED.qty_normal, qty_foil=EXCLUDED.qty_foil, updated_at=now()""",
        (card_id, body.qty_normal, body.qty_foil),
    )
    return {"card_id": card_id, "qty_normal": body.qty_normal, "qty_foil": body.qty_foil}
