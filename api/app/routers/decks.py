from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..services import deck_import

router = APIRouter()


class DeckCard(BaseModel):
    card_id: str
    qty: int = Field(ge=1)


class DeckIn(BaseModel):
    name: str
    notes: str = ""
    cards: list[DeckCard] = []


class DeckImportIn(BaseModel):
    name: str
    text: str


def _deck_row(deck_id: int) -> dict:
    deck = db.query_one("SELECT * FROM decks WHERE id=%s", (deck_id,))
    if not deck:
        raise HTTPException(404, "no such deck")
    deck["cards"] = db.query(
        """SELECT dc.card_id, dc.qty, c.full_name, c.ink, c.inks, c.cost, c.rarity, c.type,
                  s.code AS set_code, c.collector_number, c.image_small,
                  COALESCE(col.qty_normal,0) + COALESCE(col.qty_foil,0) AS owned
           FROM deck_cards dc
           JOIN cards c ON c.id = dc.card_id
           JOIN sets s ON s.id = c.set_id
           LEFT JOIN collection col ON col.card_id = dc.card_id
           WHERE dc.deck_id = %s
           ORDER BY c.cost NULLS LAST, c.full_name""",
        (deck_id,),
    )
    deck["card_total"] = sum(c["qty"] for c in deck["cards"])
    return deck


def _write_cards(conn, deck_id: int, cards: list[DeckCard]):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM deck_cards WHERE deck_id=%s", (deck_id,))
        for c in cards:
            cur.execute(
                "INSERT INTO deck_cards (deck_id, card_id, qty) VALUES (%s,%s,%s)",
                (deck_id, c.card_id, c.qty),
            )


@router.get("/decks")
def list_decks():
    return db.query(
        """SELECT d.id, d.name, d.notes, d.updated_at,
                  COALESCE(sum(dc.qty), 0) AS card_total
           FROM decks d LEFT JOIN deck_cards dc ON dc.deck_id = d.id
           GROUP BY d.id ORDER BY d.name"""
    )


@router.post("/decks", status_code=201)
def create_deck(body: DeckIn):
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO decks (name, notes) VALUES (%s,%s) RETURNING id",
                    (body.name, body.notes),
                )
            except Exception:
                raise HTTPException(409, f"deck {body.name!r} already exists")
            deck_id = cur.fetchone()["id"]
        _write_cards(conn, deck_id, body.cards)
        conn.commit()
    return _deck_row(deck_id)


@router.post("/decks/import", status_code=201)
def import_deck(body: DeckImportIn):
    entries, bad_lines = deck_import.parse_deck_text(body.text)
    if not entries:
        raise HTTPException(422, "no parseable deck lines")
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            matched, unmatched = deck_import.match_deck_entries(cur, entries)
            try:
                cur.execute(
                    "INSERT INTO decks (name, notes) VALUES (%s,%s) RETURNING id",
                    (body.name, ""),
                )
            except Exception:
                raise HTTPException(409, f"deck {body.name!r} already exists")
            deck_id = cur.fetchone()["id"]
        _write_cards(conn, deck_id, [DeckCard(**c) for c in matched])
        conn.commit()
    deck = _deck_row(deck_id)
    deck["unmatched"] = unmatched + [{"qty": None, "name": l, "reason": "unparseable line"} for l in bad_lines]
    return deck


@router.get("/decks/{deck_id}")
def get_deck(deck_id: int):
    return _deck_row(deck_id)


@router.put("/decks/{deck_id}")
def update_deck(deck_id: int, body: DeckIn):
    if not db.query_one("SELECT 1 FROM decks WHERE id=%s", (deck_id,)):
        raise HTTPException(404, "no such deck")
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE decks SET name=%s, notes=%s, updated_at=now() WHERE id=%s",
                (body.name, body.notes, deck_id),
            )
        _write_cards(conn, deck_id, body.cards)
        conn.commit()
    return _deck_row(deck_id)


@router.delete("/decks/{deck_id}", status_code=204)
def delete_deck(deck_id: int):
    if db.execute("DELETE FROM decks WHERE id=%s", (deck_id,)) == 0:
        raise HTTPException(404, "no such deck")


@router.get("/decks/{deck_id}/buildable")
def buildable(deck_id: int):
    deck = _deck_row(deck_id)
    cards = [
        {
            "card_id": c["card_id"], "full_name": c["full_name"],
            "need": c["qty"], "have": c["owned"],
            "missing": max(0, c["qty"] - c["owned"]),
        }
        for c in deck["cards"]
    ]
    missing = [c for c in cards if c["missing"] > 0]
    return {
        "deck_id": deck_id, "name": deck["name"], "buildable": not missing,
        "cards": cards, "missing": missing,
        "missing_total": sum(c["missing"] for c in missing),
    }
