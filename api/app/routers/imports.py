from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .. import db
from ..services import importer

router = APIRouter()


@router.post("/imports")
async def upload(
    file: UploadFile = File(...),
    mode: str = Form("replace"),
    dry_run: bool = Form(False),
    force: bool = Form(False),
):
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "file too large")
    try:
        with db.pool.connection() as conn:
            return importer.run_import(conn, file.filename or "upload", data, mode, dry_run, force)
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
                  matched_rows, unmatched_count, summary
           FROM imports ORDER BY id DESC LIMIT %s""",
        (min(limit, 200),),
    )


@router.get("/imports/{import_id}")
def detail(import_id: int):
    row = db.query_one("SELECT * FROM imports WHERE id=%s", (import_id,))
    if not row:
        raise HTTPException(404, "no such import")
    return row
