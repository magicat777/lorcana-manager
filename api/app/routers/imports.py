from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from .. import db
from ..services import importer

router = APIRouter()


@router.post("/imports")
async def upload(
    file: UploadFile = File(...),
    mode: str = Form("replace"),
    dry_run: bool = Form(False),
    force: bool = Form(False),
    note: str = Form(""),
):
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "file too large")
    try:
        with db.pool.connection() as conn:
            return importer.run_import(conn, file.filename or "upload", data, mode, dry_run,
                                       force, note=note)
    except importer.DuplicateFileError as e:
        raise HTTPException(
            409,
            detail={
                "warning": "duplicate file",
                "previous_import_id": e.previous_import_id,
                "hint": "this exact file was already merged; re-send with force=true to merge again",
            },
        )
    except importer.ImportError_ as e:
        raise HTTPException(422, str(e))


@router.get("/imports")
def history(limit: int = 50):
    return db.query(
        """SELECT id, filename, uploaded_at, mode, dry_run, row_count,
                  matched_rows, unmatched_count, summary, note,
                  diff->'summary' AS diff_summary
           FROM imports ORDER BY id DESC LIMIT %s""",
        (min(limit, 200),),
    )


@router.get("/imports/{import_id}")
def detail(import_id: int):
    row = db.query_one("SELECT * FROM imports WHERE id=%s", (import_id,))
    if not row:
        raise HTTPException(404, "no such import")
    return row


class NoteIn(BaseModel):
    note: str = ""


class ToPoolIn(BaseModel):
    deck_id: int


@router.post("/imports/{import_id}/to-pool")
def added_cards_to_pool(import_id: int, body: ToPoolIn):
    """Push this import's ADDED cards (positive diff deltas — e.g. packs opened
    at a sealed event) into a sealed deck's pool, isolating them from the rest
    of the collection for limited deck building."""
    imp = db.query_one("SELECT id, filename, note, diff FROM imports WHERE id=%s", (import_id,))
    if not imp:
        raise HTTPException(404, "no such import")
    added = [c for c in (imp.get("diff") or {}).get("cards", []) if c["delta"] > 0]
    if not added:
        raise HTTPException(422, "this import has no added cards (or predates diff tracking)")
    deck = db.query_one("SELECT id, name, format FROM decks WHERE id=%s", (body.deck_id,))
    if not deck:
        raise HTTPException(404, "no such deck")
    if deck["format"] != "sealed":
        raise HTTPException(422, f"deck '{deck['name']}' is not a sealed deck")

    with db.pool.connection() as conn, conn.cursor() as cur:
        for c in added:
            cur.execute(
                """INSERT INTO deck_pool (deck_id, card_id, qty) VALUES (%s,%s,%s)
                   ON CONFLICT (deck_id, card_id)
                   DO UPDATE SET qty = deck_pool.qty + EXCLUDED.qty""",
                (body.deck_id, c["card_id"], c["delta"]),
            )
        label = imp["note"] or imp["filename"]
        cur.execute(
            "INSERT INTO deck_events (deck_id, action, detail) VALUES (%s,%s,%s)",
            (body.deck_id, "pool",
             f"+{sum(c['delta'] for c in added)} cards from import #{import_id} ({label})"),
        )
        conn.commit()
    return {"deck_id": body.deck_id, "deck_name": deck["name"],
            "cards": len(added), "copies": sum(c["delta"] for c in added)}


@router.patch("/imports/{import_id}")
def set_note(import_id: int, body: NoteIn):
    """Annotate an upload after the fact (e.g. 'sealed competition winnings')."""
    row = db.query_one(
        "UPDATE imports SET note=%s WHERE id=%s RETURNING id, note",
        (body.note.strip() or None, import_id),
    )
    if not row:
        raise HTTPException(404, "no such import")
    return row
