"""Morning brief job: print to logs (-> Loki), optionally push to ntfy.

Push happens only when LORCANA_NTFY_URL is set (e.g. https://ntfy.sh/<private-topic>)
— never defaults to a public topic. Tapping the notification opens the web
brief; new news items become ntfy action buttons (max 2 of ntfy's 3)."""
import os
import sys

import httpx

from .. import db
from ..services import brief


def _action_label(title: str) -> str:
    # HTTP header values are latin-1; ntfy's Actions syntax reserves , ; "
    t = title.encode("ascii", "ignore").decode().replace('"', "'").strip()
    return (t[:37] + "...") if len(t) > 40 else t


def _ntfy_headers(b: dict) -> dict:
    # mDNS name, not a literal IP: the host is on wifi DHCP and its lease
    # has already moved once, which silently deadened every link in the
    # brief. The .local name follows the lease.
    web = os.getenv("LORCANA_WEB_URL", "http://jason-holt-blade-18-rz09-0484.local:30710").rstrip("/")
    headers = {"Title": "Lorcana Brief", "Tags": "black_joker",
               "Click": f"{web}/brief"}
    actions = [f'view, "{_action_label(n["title"])}", {n["url"]}'
               for n in b.get("news", []) if n["is_new"]][:2]
    if actions:
        headers["Actions"] = "; ".join(actions)
    return headers


def main() -> int:
    db.pool.open()
    try:
        b = brief.build_brief()
        text = brief.render_text(b)
        print(text, flush=True)
        url = os.getenv("LORCANA_NTFY_URL", "").strip()
        if url:
            headers = _ntfy_headers(b)
            r = httpx.post(url, content=text.encode(), headers=headers, timeout=15)
            r.raise_for_status()
            print(f"click={headers['Click']} actions={headers.get('Actions', '-')}",
                  flush=True)
            print(f"pushed to ntfy ({r.status_code})", flush=True)
        else:
            print("LORCANA_NTFY_URL not set — log-only brief", flush=True)
    finally:
        db.pool.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
