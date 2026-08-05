from fastapi import APIRouter

from ..services import brief

router = APIRouter()


@router.get("/brief")
def get_brief():
    b = brief.build_brief()
    b["text"] = brief.render_text(b)
    return b
