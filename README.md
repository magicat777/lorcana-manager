# Lorcana Collection

Disney Lorcana TCG card database + collection manager on the ODIN k3s cluster.

- **Web UI:** http://jason-holt-blade-18-rz09-0484.local:30710 — browse cards, upload Dreamborn.ink exports,
  decks, stats.
- **API:** FastAPI behind the same NodePort under `/api` (nginx same-origin proxy).
- **DB:** database `lorcana` on the shared odin-prime PostgreSQL
  (`postgresql.odin-prime.svc:5432`, browse via pgAdmin :30880).
- **Catalog:** seeded from the [Lorcast API](https://lorcast.com/docs/api); nightly
  price-refresh CronJob (05:00 PT).
- **News:** daily CronJob (07:30 PT) scrapes official news from
  disneylorcana.com into `news_items`; new items surface in the brief (web,
  ntfy push, MCP) — add further official channels in `api/app/jobs/fetch_news.py`.
- **Claude:** `lorcana` domain in [odin-mcp](../odin-mcp/) exposes search, stats,
  missing-card, and deck/buildable tools.
- **Backups:** nightly `pg_dump -Fc` CronJob (02:00 PT) to
  `/mnt/lvm_k3s/backups/lorcana/` on the host (30-day retention), then synced
  off-host to the Synology NAS at `/mnt/nas/odin-storage/k3s-backups/lorcana/`
  (60-day retention). Dump verified before any pruning; ntfy alert on failure.
  Restore procedure in [docs/ADMIN_USER_GUIDE.md](docs/ADMIN_USER_GUIDE.md) §7.

## Collection import

Export CSV from the Dreamborn.ink app (columns `Name, Normal, Foil, Color, Rarity,
Set, Card Number`; `.xlsx` with the same header also works) and upload it on the
**Upload** page.

- **Replace** — full snapshot: zeroes everything, then sets the file's counts.
  Idempotent; re-uploading the same file is harmless. Use this for full-collection
  exports (the normal Dreamborn workflow).
- **Merge** — adds counts on top (for partial scans). Re-merging the exact same file
  is refused (409) unless forced.
- **Dry run** previews matching + before/after totals without writing.
- Cards are matched by set + collector number, with a set-scoped name fallback;
  unmatched rows are reported and land in the `imports` audit table. Unknown
  Dreamborn set labels get fixed by adding a row to `set_aliases`
  (`db/migrations/002_set_aliases_seed.sql`).

## Deploy / operate

```bash
# build + push images (bump the date suffix AND the tags in deploy/*/deployment.yaml + jobs)
buildah bud --format docker -t localhost:30500/lorcana/api:fastapi-YYYYMMDD api/
buildah push --tls-verify=false localhost:30500/lorcana/api:fastapi-YYYYMMDD
buildah bud --format docker -t localhost:30500/lorcana/web:nginx-YYYYMMDD web/
buildah push --tls-verify=false localhost:30500/lorcana/web:nginx-YYYYMMDD

./deploy/apply.sh          # namespace, secret (once), db bootstrap (once), migrations, rollout

# seed / refresh the card catalog (rerun after new set releases)
kubectl -n lorcana delete job lorcana-seed --ignore-not-found
kubectl apply -f deploy/jobs/seed-job.yaml
kubectl -n lorcana logs -f job/lorcana-seed
```

The one-time DB bootstrap runs `db/migrations/000_role_db.sql` through the odin-prime
postgres pod (`kubectl exec`); the app role password lives only in the `lorcana-db`
secret. Schema migrations (`001+`) are all `IF NOT EXISTS`-idempotent and re-applied
by a Job on every `apply.sh`.

## Daily brief push (ntfy)

The `lorcana-daily-brief` CronJob (8am PT) pushes to ntfy only when the
`lorcana-ntfy` secret exists (key `LORCANA_NTFY_URL`, a private unguessable
topic URL — topic name = password on public ntfy.sh). Without it the brief is
log-only (Loki). The topic URL is also kept at
`~/Projects/secrets/lorcana.ntfy.url.s` (never committed). Subscribe to the
topic in the ntfy phone app. To rotate:

```bash
URL="https://ntfy.sh/odin-lorcana-$(openssl rand -hex 8)"
echo "$URL" > ~/Projects/secrets/lorcana.ntfy.url.s
kubectl -n lorcana delete secret lorcana-ntfy
kubectl -n lorcana create secret generic lorcana-ntfy --from-literal=LORCANA_NTFY_URL="$URL"
# then re-subscribe to the new topic on the phone
```
