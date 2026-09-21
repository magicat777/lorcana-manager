"""Replay backfill worker: fetch duels.ink replays for ledger rows that
don't have one yet. RUN BY HAND (kubectl job) — no CronJob until the first
backfill proves out, per Jason's approval terms:

  kubectl -n lorcana delete job lorcana-replay-fetch --ignore-not-found && \
  kubectl apply -f deploy/jobs/replay-fetch-job.yaml

Politeness contract (duels.ink robots.txt, checked 2026-09-18: /r/ allowed
for ordinary clients): 1 request/second, identifying User-Agent, cache by
game_id, NEVER refetch. A 403/429 aborts the run loudly — per the standing
news-source rule, we remove or stop, never disguise the client."""
import sys
import time

import httpx
import psycopg
from psycopg.rows import dict_row

from .. import config
from ..services.duels_replay import PARSE_VERSION, parse_replay

UA = {"User-Agent": "lorcana-manager/1.0 (personal collection tool; "
                    "one-time backfill of the owner's own replays; slow)"}
# First real run (2026-09-20): 429 after ~5 fetches at 1 req/s — their
# limiter is stricter than robots suggested. 429 is backpressure, not a
# block: honor Retry-After, pace at 10s, back off exponentially, give up
# only when a long backoff still 429s. 403 remains an immediate stop.
DELAY_S = 10.0
MAX_BACKOFF_S = 300


def main() -> int:
    ok = failed = 0
    with psycopg.connect(config.DATABASE_URL, row_factory=dict_row) as conn, \
         httpx.Client(timeout=30, headers=UA, follow_redirects=True) as client:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT g.game_id, g.replay_id FROM duels_games g
                   WHERE g.replay_id IS NOT NULL
                     AND NOT EXISTS (SELECT 1 FROM duels_replays r
                                     WHERE r.game_id = g.game_id)
                   ORDER BY g.started_at""")
            targets = cur.fetchall()
        print(f"fetching {len(targets)} replays", flush=True)
        with conn.cursor() as cur:
            for t in targets:
                time.sleep(DELAY_S)
                backoff = DELAY_S
                while True:
                    r = client.get(f"https://duels.ink/r/{t['replay_id']}")
                    if r.status_code != 429:
                        break
                    retry_after = r.headers.get("Retry-After")
                    wait = min(MAX_BACKOFF_S,
                               int(retry_after) if (retry_after or "").isdigit()
                               else backoff * 2)
                    if wait >= MAX_BACKOFF_S and backoff >= MAX_BACKOFF_S:
                        print("[LORE] 429 persists after max backoff — stopping; "
                              "re-run later, already-fetched replays are cached.",
                              flush=True)
                        conn.commit()
                        return 1
                    print(f"  429 — backing off {wait}s", flush=True)
                    time.sleep(wait)
                    backoff = wait
                if r.status_code == 403:
                    print("[LORE] duels.ink returned 403 — STOPPING. Per the "
                          "approval terms we do not work around blocks; ask the "
                          "maintainers before retrying.", flush=True)
                    conn.commit()
                    return 1
                if r.status_code != 200:
                    failed += 1
                    print(f"  {t['game_id']}: HTTP {r.status_code}", flush=True)
                    continue
                try:
                    metrics, warnings = parse_replay(r.content)
                    cur.execute(
                        """INSERT INTO duels_replays (game_id, replay_id, raw_gz,
                             source, parse_version, metrics, parse_warnings)
                           VALUES (%s, %s, %s, 'fetch', %s, %s, %s)
                           ON CONFLICT (game_id) DO NOTHING""",
                        (t["game_id"], t["replay_id"], r.content, PARSE_VERSION,
                         psycopg.types.json.Jsonb(metrics),
                         psycopg.types.json.Jsonb(warnings)))
                    ok += 1
                    if warnings:
                        print(f"  {t['game_id']}: ok with {len(warnings)} warning(s): "
                              f"{warnings[:3]}", flush=True)
                except Exception as e:
                    # raw kept even when parsing fails: recompute later
                    cur.execute(
                        """INSERT INTO duels_replays (game_id, replay_id, raw_gz,
                             source, parse_version, metrics, parse_warnings)
                           VALUES (%s, %s, %s, 'fetch', NULL, NULL, %s)
                           ON CONFLICT (game_id) DO NOTHING""",
                        (t["game_id"], t["replay_id"], r.content,
                         psycopg.types.json.Jsonb([f"parse failed: {e}"])))
                    failed += 1
                    print(f"  {t['game_id']}: stored raw, parse failed: {e}", flush=True)
            conn.commit()
    print(f"done: {ok} parsed, {failed} failed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
