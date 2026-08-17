"""Daily collection snapshot job: append one collection_snapshots row so the
Stats page gets a daily value/size series (prices only move on the weekly
refresh, but quantities move whenever cards are scanned or imported).

Idempotent per day: a rerun on a day that already has a 'daily' snapshot is a
no-op, so re-applying the CronJob or replaying a missed run is safe. Import
snapshots are separate rows and never suppress the daily one."""
import sys

from .. import db
from ..services import snapshots


def main() -> int:
    db.pool.open()
    try:
        with db.pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """SELECT id FROM collection_snapshots
                   WHERE source = 'daily' AND captured_at::date = CURRENT_DATE"""
            )
            existing = cur.fetchone()
            if existing:
                print(f"daily snapshot already exists today (#{existing['id']}) — skipping",
                      flush=True)
                return 0
            snap_id = snapshots.capture(cur, "daily")
            conn.commit()
            cur.execute(
                "SELECT total_cards, unique_cards, value_usd FROM collection_snapshots WHERE id=%s",
                (snap_id,),
            )
            row = cur.fetchone()
            print(f"snapshot #{snap_id}: {row['total_cards']} copies, "
                  f"{row['unique_cards']} unique, ${row['value_usd']}", flush=True)
    finally:
        db.pool.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
