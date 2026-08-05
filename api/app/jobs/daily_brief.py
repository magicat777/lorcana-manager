"""Morning brief job: print to logs (-> Loki), optionally push to ntfy.

Push happens only when LORCANA_NTFY_URL is set (e.g. https://ntfy.sh/<private-topic>)
— never defaults to a public topic."""
import os
import sys

import httpx

from .. import db
from ..services import brief


def main() -> int:
    db.pool.open()
    try:
        b = brief.build_brief()
        text = brief.render_text(b)
        print(text, flush=True)
        url = os.getenv("LORCANA_NTFY_URL", "").strip()
        if url:
            r = httpx.post(url, content=text.encode(),
                           headers={"Title": "Lorcana Brief", "Tags": "black_joker"},
                           timeout=15)
            r.raise_for_status()
            print(f"pushed to ntfy ({r.status_code})", flush=True)
        else:
            print("LORCANA_NTFY_URL not set — log-only brief", flush=True)
    finally:
        db.pool.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
