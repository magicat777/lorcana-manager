"""Overnight sim-lab results: ingested by the lorcana-sim nightly
CronJob (Lorcana-Sim repo), read by the daily brief. Rows in one POST
share run_at (one transaction) — that timestamp identifies a batch."""
from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import db

router = APIRouter()


class SimRowIn(BaseModel):
    matchup: str
    games: int = Field(gt=0)
    p0_wins: int = Field(ge=0)
    p1_wins: int = Field(ge=0)
    avg_turns: float | None = None
    avg_branching: float | None = None
    ms_per_game: float | None = None


class SimRunIn(BaseModel):
    engine_build: str
    seed_base: int | None = None
    results: list[SimRowIn]


@router.post("/sim/results")
def ingest(run: SimRunIn):
    # One transaction for the whole batch: postgres now() is fixed per
    # transaction, so every row shares run_at — the batch identity the
    # brief's "latest batch" query relies on.
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO sim_results
                     (engine_build, seed_base, matchup, games, p0_wins, p1_wins,
                      avg_turns, avg_branching, ms_per_game)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [(run.engine_build, run.seed_base, r.matchup, r.games, r.p0_wins,
                  r.p1_wins, r.avg_turns, r.avg_branching, r.ms_per_game)
                 for r in run.results])
    return {"inserted": len(run.results)}


@router.get("/sim/latest")
def latest():
    return db.query(
        """SELECT run_at, engine_build, seed_base, matchup, games, p0_wins,
                  p1_wins, avg_turns, avg_branching, ms_per_game
           FROM sim_results
           WHERE run_at = (SELECT max(run_at) FROM sim_results)
           ORDER BY id""")
