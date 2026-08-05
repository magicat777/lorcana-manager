from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import db
from .routers import cards, collection, decks, imports, stats


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.pool.open()
    yield
    db.pool.close()


app = FastAPI(title="Lorcana Collection API", lifespan=lifespan)


@app.get("/api/health")
def health():
    db.query_one("SELECT 1")
    return {"status": "ok"}


for r in (cards, collection, imports, decks, stats):
    app.include_router(r.router, prefix="/api")
