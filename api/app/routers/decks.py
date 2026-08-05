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
    source: str = "api"       # provenance: who wrote this ('mcp', 'webui', 'api')


class DeckImportIn(BaseModel):
    name: str
    text: str
    notes: str = ""
    overwrite: bool = False   # replace an existing deck of the same name
    source: str = "api"
    strict: bool = False      # refuse the write if validation warnings exist


def _validate(cards: list[dict]) -> list[str]:
    """Deck-legality warnings: 60 cards, max 4 per full name, at most 2 inks
    (a dual-ink card is fine if it shares an ink with the deck's two)."""
    warnings = []
    total = sum(c["qty"] for c in cards)
    if total != 60:
        warnings.append(f"{total} cards — constructed decks are exactly 60")
    by_name: dict[str, int] = {}
    for c in cards:
        by_name[c["full_name"]] = by_name.get(c["full_name"], 0) + c["qty"]
    for name, qty in sorted(by_name.items()):
        if qty > 4:
            warnings.append(f"{qty} copies of {name!r} (max 4 per name)")
    mono: set[str] = set()
    duals: list[tuple[str, set[str]]] = []
    for c in cards:
        inks = c.get("inks") or ([c["ink"]] if c.get("ink") else [])
        if len(inks) == 1:
            mono.add(inks[0])
        elif len(inks) > 1:
            duals.append((c["full_name"], set(inks)))
    if len(mono) > 2:
        warnings.append(f"{len(mono)} inks ({', '.join(sorted(mono))}) — decks may use at most 2")
    elif len(mono) == 2:
        for name, dinks in duals:
            if not dinks & mono:
                warnings.append(
                    f"{name!r} ({'/'.join(sorted(dinks))}) shares no ink with the deck's "
                    f"{'/'.join(sorted(mono))}")
    return warnings


def _deck_row(deck_id: int) -> dict:
    deck = db.query_one("SELECT * FROM decks WHERE id=%s", (deck_id,))
    if not deck:
        raise HTTPException(404, "no such deck")
    deck["cards"] = db.query(
        """SELECT dc.card_id, dc.qty, c.full_name, c.ink, c.inks, c.cost, c.rarity, c.type,
                  s.code AS set_code, c.collector_number, c.image_small,
                  COALESCE(col.qty_normal,0) + COALESCE(col.qty_foil,0) AS owned,
                  COALESCE((SELECT sum(dc2.qty) FROM deck_cards dc2
                            JOIN decks d2 ON d2.id = dc2.deck_id
                            WHERE dc2.card_id = dc.card_id AND d2.in_use
                              AND d2.id <> dc.deck_id), 0) AS allocated_elsewhere
           FROM deck_cards dc
           JOIN cards c ON c.id = dc.card_id
           JOIN sets s ON s.id = c.set_id
           LEFT JOIN collection col ON col.card_id = dc.card_id
           WHERE dc.deck_id = %s
           ORDER BY c.cost NULLS LAST, c.full_name""",
        (deck_id,),
    )
    for c in deck["cards"]:
        c["free"] = max(0, c["owned"] - c["allocated_elsewhere"])
    deck["card_total"] = sum(c["qty"] for c in deck["cards"])
    deck["validation"] = _validate(deck["cards"])
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
        """SELECT d.id, d.name, d.notes, d.in_use, d.updated_at,
                  COALESCE(sum(dc.qty), 0) AS card_total
           FROM decks d LEFT JOIN deck_cards dc ON dc.deck_id = d.id
           GROUP BY d.id ORDER BY d.in_use DESC, d.name"""
    )


@router.post("/decks", status_code=201)
def create_deck(body: DeckIn):
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO decks (name, notes, created_source) VALUES (%s,%s,%s) RETURNING id",
                    (body.name, body.notes, body.source),
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
    all_unmatched_suffix = [{"qty": None, "name": l, "reason": "unparseable line"} for l in bad_lines]
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            matched, unmatched = deck_import.match_deck_entries(cur, entries)
            wanted = {c["card_id"]: c["qty"] for c in matched}

            # validate BEFORE writing so strict mode can refuse cleanly
            cur.execute(
                "SELECT id, full_name, ink, inks FROM cards WHERE id = ANY(%s)",
                (list(wanted),),
            )
            card_rows = [{**r, "qty": wanted[r["id"]]} for r in cur.fetchall()]
            warnings = _validate(card_rows)
            if body.strict and warnings:
                raise HTTPException(422, detail={
                    "error": "deck failed validation (strict mode) — nothing written",
                    "validation": warnings,
                    "unmatched": unmatched + all_unmatched_suffix,
                })

            cur.execute("SELECT id, notes FROM decks WHERE name=%s", (body.name,))
            existing = cur.fetchone()
            created = existing is None

            # idempotency: identical card list (+ compatible notes) is a no-op,
            # regardless of the overwrite flag
            if existing:
                cur.execute(
                    "SELECT card_id, qty FROM deck_cards WHERE deck_id=%s", (existing["id"],))
                current = {r["card_id"]: r["qty"] for r in cur.fetchall()}
                notes_same = body.notes in ("", existing["notes"] or "")
                if current == wanted and notes_same:
                    deck = _deck_row(existing["id"])
                    deck["created"] = False
                    deck["unchanged"] = True
                    deck["unmatched"] = unmatched + all_unmatched_suffix
                    return deck

            if existing and not body.overwrite:
                raise HTTPException(
                    409, f"deck {body.name!r} already exists (send overwrite=true to replace)")
            if existing:
                deck_id = existing["id"]
                cur.execute(
                    "UPDATE decks SET notes=%s, updated_at=now(), updated_source=%s WHERE id=%s",
                    (body.notes, body.source, deck_id),
                )
            else:
                cur.execute(
                    "INSERT INTO decks (name, notes, created_source) VALUES (%s,%s,%s) RETURNING id",
                    (body.name, body.notes, body.source),
                )
                deck_id = cur.fetchone()["id"]
        _write_cards(conn, deck_id, [DeckCard(**c) for c in matched])
        conn.commit()
    deck = _deck_row(deck_id)
    deck["created"] = created
    deck["unchanged"] = False
    deck["unmatched"] = unmatched + all_unmatched_suffix
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
                "UPDATE decks SET name=%s, notes=%s, updated_at=now(), updated_source=%s WHERE id=%s",
                (body.name, body.notes, body.source, deck_id),
            )
        _write_cards(conn, deck_id, body.cards)
        conn.commit()
    return _deck_row(deck_id)


@router.delete("/decks/{deck_id}", status_code=204)
def delete_deck(deck_id: int):
    if db.execute("DELETE FROM decks WHERE id=%s", (deck_id,)) == 0:
        raise HTTPException(404, "no such deck")


class InUseIn(BaseModel):
    in_use: bool
    force: bool = False   # mark built even when free copies are short


def _buildable(deck: dict) -> dict:
    """Validate against FREE copies: owned minus copies allocated to OTHER
    in_use decks. 'have' stays raw owned for reference."""
    cards = [
        {
            "card_id": c["card_id"], "full_name": c["full_name"],
            "need": c["qty"], "have": c["owned"],
            "allocated_elsewhere": c["allocated_elsewhere"], "free": c["free"],
            "missing": max(0, c["qty"] - c["free"]),
        }
        for c in deck["cards"]
    ]
    missing = [c for c in cards if c["missing"] > 0]
    return {
        "deck_id": deck["id"], "name": deck["name"], "in_use": deck["in_use"],
        "buildable": not missing, "cards": cards, "missing": missing,
        "missing_total": sum(c["missing"] for c in missing),
    }


@router.get("/decks/{deck_id}/buildable")
def buildable(deck_id: int):
    return _buildable(_deck_row(deck_id))


@router.put("/decks/{deck_id}/in_use")
def set_in_use(deck_id: int, body: InUseIn):
    deck = _deck_row(deck_id)
    if body.in_use and not deck["in_use"] and not body.force:
        b = _buildable(deck)
        if b["missing"]:
            raise HTTPException(409, detail={
                "error": "not enough free copies to build this deck",
                "missing": b["missing"],
                "hint": "cards are allocated to other in-use decks or not owned; "
                        "send force=true to mark it built anyway",
            })
    db.execute("UPDATE decks SET in_use=%s, updated_at=now() WHERE id=%s",
               (body.in_use, deck_id))
    return _deck_row(deck_id)
