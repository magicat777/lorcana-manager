"""Simulation endpoints.

Two independent flows share this router:

1. Overnight sim lab — the nightly CronJob (Lorcana-Sim repo) POSTs
   aggregate matchup results; the daily brief reads the latest batch.
   Rows in one POST share run_at (one transaction) = batch identity.

2. Per-deck simulation — the web UI or Claude (MCP) queues a run for a
   deck; the lorcana-sim worker claims it, plays the games, and posts
   results back; the deck's Sim tab displays them. A run whose deck
   contains cards the engine can't play faithfully comes back
   "unsupported" WITH the offending cards, never an approximated
   number.
"""
from fastapi import APIRouter, HTTPException
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


# ---------------------------------------------------------------------------
# Per-deck simulation runs
# ---------------------------------------------------------------------------

RUN_COLS = """id, deck_id, opponent, opponent_label, games, policy, seed_base,
  status, requested_by, requested_at, claimed_at, finished_at, worker,
  engine_build, wins, losses, win_rate, avg_turns, wins_as_p0, wins_as_p1,
  elapsed_s, error, unsupported_cards, analyze_requested, analysis"""

POLICIES = ("heuristic", "random", "mcts16", "mcts32", "mcts64", "mcts128")


class SimRequestIn(BaseModel):
    opponent: str = "deck3"       # 'deck2'|'deck3' baselines, or a deck id
    games: int = Field(200, ge=10, le=5000)
    policy: str = "heuristic"
    requested_by: str = "api"
    analyze: bool = False       # also run the teacher pass over the result
    # Reuse another run's seeds: the two decks then face IDENTICAL
    # shuffles and opening hands, so the difference between them is the
    # decklist change and not the luck. Set by "compare to this run".
    seed_base: int | None = None


class ClaimIn(BaseModel):
    worker: str = "unknown"


class SimResultIn(BaseModel):
    status: str                    # complete | unsupported | error
    error: str | None = None
    unsupported_cards: list[dict] | None = None
    opponent_label: str | None = None
    policy: str | None = None
    engine_build: str | None = None
    seed_base: int | None = None
    games: int | None = None
    wins: int | None = None
    losses: int | None = None
    win_rate: float | None = None
    avg_turns: float | None = None
    wins_as_p0: int | None = None
    wins_as_p1: int | None = None
    elapsed_s: float | None = None
    analysis: dict | None = None


@router.post("/decks/{deck_id}/sim", status_code=201)
def queue_sim(deck_id: int, body: SimRequestIn):
    """Queue a simulation for this deck. The worker picks it up within
    its poll interval; poll GET /sim/runs?deck_id= for the result."""
    if not db.query_one("SELECT 1 FROM decks WHERE id=%s", (deck_id,)):
        raise HTTPException(404, "no such deck")
    if body.policy not in POLICIES:
        raise HTTPException(422, f"policy must be one of {', '.join(POLICIES)}")
    if body.opponent not in ("deck2", "deck3"):
        # An opponent deck id must exist and not be the deck itself.
        if not body.opponent.isdigit():
            raise HTTPException(422, "opponent must be 'deck2', 'deck3', or a deck id")
        if int(body.opponent) == deck_id:
            raise HTTPException(422, "a deck can't be simulated against itself")
        if not db.query_one("SELECT 1 FROM decks WHERE id=%s", (int(body.opponent),)):
            raise HTTPException(404, "no such opponent deck")
    return db.query_one(
        f"""INSERT INTO sim_deck_runs
              (deck_id, opponent, games, policy, requested_by, analyze_requested, seed_base)
            VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING {RUN_COLS}""",
        (deck_id, body.opponent, body.games, body.policy, body.requested_by,
         body.analyze, body.seed_base))


@router.get("/sim/runs")
def list_runs(deck_id: int | None = None, limit: int = 25):
    where, params = "", []
    if deck_id is not None:
        where, params = "WHERE deck_id = %s", [deck_id]
    return db.query(
        f"""SELECT {RUN_COLS}, (SELECT name FROM decks d WHERE d.id = deck_id) AS deck_name
            FROM sim_deck_runs {where}
            ORDER BY requested_at DESC LIMIT %s""",
        [*params, min(limit, 100)])


@router.get("/sim/compare")
def compare(a: int, b: int):
    """Two finished runs side by side. When they share a seed_base,
    opponent, games and policy, the comparison is PAIRED — identical
    shuffles for both decklists — so a small delta is still real; a
    delta between unpaired runs is mostly noise and is flagged."""
    rows = db.query(f"SELECT {RUN_COLS} FROM sim_deck_runs WHERE id = ANY(%s)", ([a, b],))
    by_id = {r["id"]: r for r in rows}
    if a not in by_id or b not in by_id:
        raise HTTPException(404, "no such run")
    ra, rb = by_id[a], by_id[b]
    paired = (
        ra["seed_base"] is not None
        and ra["seed_base"] == rb["seed_base"]
        and ra["opponent"] == rb["opponent"]
        and ra["games"] == rb["games"]
        and ra["policy"] == rb["policy"]
    )
    delta = None
    if ra["win_rate"] is not None and rb["win_rate"] is not None:
        delta = float(rb["win_rate"]) - float(ra["win_rate"])
    return {"a": ra, "b": rb, "paired": paired, "win_rate_delta": delta}


@router.get("/sim/runs/{run_id}")
def get_run(run_id: int):
    row = db.query_one(f"SELECT {RUN_COLS} FROM sim_deck_runs WHERE id=%s", (run_id,))
    if not row:
        raise HTTPException(404, "no such run")
    return row


# How long a run may sit in 'running' before its worker is presumed
# dead. Generous, because a legitimate mcts128 sweep is slow — this is a
# crash recovery, not a latency budget.
STALE_CLAIM = "45 minutes"


@router.post("/sim/runs/claim")
def claim_run(body: ClaimIn):
    """Atomically hand the oldest queued run to a worker. SKIP LOCKED
    keeps two workers from claiming the same row; returns null (204-ish
    empty body) when the queue is empty.

    First, requeue anything whose worker died holding it. SKIP LOCKED
    stops two workers taking one run, but nothing releases a run whose
    worker vanished mid-flight — and a rollout does exactly that to
    whatever was claimed seconds earlier. Such a row sits in 'running'
    forever, indistinguishable from a slow run, and is invisible in the
    UI as anything but "still going".
    """
    # db.execute, NOT db.query: query() fetchall()s, and an UPDATE with
    # no RETURNING produces no records, so it raises — which took the
    # whole claim endpoint down and stalled every worker poll.
    db.execute(
        """UPDATE sim_deck_runs SET status='queued', claimed_at=NULL, worker=NULL
           WHERE status='running' AND claimed_at < now() - %s::interval""",
        (STALE_CLAIM,))
    return db.query_one(
        f"""UPDATE sim_deck_runs SET status='running', claimed_at=now(), worker=%s
            WHERE id = (SELECT id FROM sim_deck_runs WHERE status='queued'
                        ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1)
            RETURNING {RUN_COLS}""",
        (body.worker,))


@router.post("/sim/runs/{run_id}/result")
def post_result(run_id: int, body: SimResultIn):
    if body.status not in ("complete", "unsupported", "error"):
        raise HTTPException(422, "status must be complete|unsupported|error")
    import json as _json

    updated = db.query_one(
        f"""UPDATE sim_deck_runs SET
              status=%s, finished_at=now(), error=%s, unsupported_cards=%s,
              opponent_label=COALESCE(%s, opponent_label),
              policy=COALESCE(%s, policy), engine_build=%s, seed_base=%s,
              games=COALESCE(%s, games), wins=%s, losses=%s, win_rate=%s,
              avg_turns=%s, wins_as_p0=%s, wins_as_p1=%s, elapsed_s=%s,
              analysis=%s
            WHERE id=%s RETURNING {RUN_COLS}""",
        (body.status, body.error,
         _json.dumps(body.unsupported_cards) if body.unsupported_cards else None,
         body.opponent_label, body.policy, body.engine_build, body.seed_base,
         body.games, body.wins, body.losses, body.win_rate, body.avg_turns,
         body.wins_as_p0, body.wins_as_p1, body.elapsed_s,
         _json.dumps(body.analysis) if body.analysis else None, run_id))
    if not updated:
        raise HTTPException(404, "no such run")
    return updated


# ---------------------------------------------------------------------------
# Engine coverage (published by the engine; read by deck building)
# ---------------------------------------------------------------------------


class CoverageIn(BaseModel):
    engine_build: str
    covered: list[dict]        # [{set_code, collector_number}, ...]


@router.post("/sim/coverage")
def put_coverage(body: CoverageIn):
    """Replace the coverage manifest. Full replacement, one
    transaction: coverage only ever grows, but a card whose spec was
    withdrawn must stop claiming to be playable."""
    pairs = [(c.get("set_code"), c.get("collector_number")) for c in body.covered]
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM engine_coverage")
            cur.executemany(
                """INSERT INTO engine_coverage (card_id, engine_build)
                   SELECT c.id, %s FROM cards c JOIN sets s ON s.id = c.set_id
                   WHERE s.code = %s AND c.collector_number = %s
                   ON CONFLICT (card_id) DO UPDATE SET engine_build = EXCLUDED.engine_build""",
                [(body.engine_build, sc, num) for sc, num in pairs])
            cur.execute("SELECT count(*) AS n FROM engine_coverage")
            n = cur.fetchone()["n"]
    return {"stored": n, "submitted": len(pairs), "engine_build": body.engine_build}


@router.get("/sim/coverage")
def get_coverage():
    row = db.query_one(
        """SELECT count(*) AS playable, max(engine_build) AS engine_build,
                  max(updated_at) AS updated_at FROM engine_coverage""")
    total = db.query_one("SELECT count(*) AS n FROM cards")["n"]
    return {**row, "catalog": total}
