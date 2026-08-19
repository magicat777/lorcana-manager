# Lorcana Collection Manager — Admin & User Guide

Disney Lorcana TCG card database, collection manager, deck builder, and tournament
match log, running on the ODIN k3s cluster with Claude integration via odin-mcp.

*Last updated 2026-08-19. Source of truth is always the repo at
`~/Projects/ODIN/lorcana` (this app) and `~/Projects/ODIN/odin-mcp` (Claude tools).*

---

## Contents

1. [System overview](#1-system-overview)
2. [Quick reference](#2-quick-reference)
3. [Setup & first-time install](#3-setup--first-time-install)
4. [Configuration reference](#4-configuration-reference)
5. [Redeployment options](#5-redeployment-options)
6. [Scheduled jobs & data refresh](#6-scheduled-jobs--data-refresh)
7. [Database administration](#7-database-administration)
8. [Troubleshooting](#8-troubleshooting)
9. [Web UI user guide](#9-web-ui-user-guide)
10. [Claude / MCP tools](#10-claude--mcp-tools)
11. [API endpoint reference](#11-api-endpoint-reference)

---

## 1. System overview

```mermaid
flowchart LR
    subgraph clients [Clients]
        B[Browser]
        C[Claude via odin-mcp<br/>:30720]
        P[ntfy phone app]
    end
    subgraph k3s [k3s cluster]
        subgraph ns [namespace: lorcana]
            W[lorcana-web<br/>nginx + React SPA<br/>NodePort 30710]
            A[lorcana-api<br/>FastAPI :8000<br/>ClusterIP only]
            CJ1[CronJob: price-refresh<br/>nightly 05:00 PT]
            CJ2[CronJob: daily-brief<br/>08:00 PT]
            CJ3[CronJobs: backup 02:00 · snapshot 06:00 · news 07:30]
            J1[Job: migrate<br/>run by apply.sh]
            J2[Job: seed<br/>manual]
        end
        subgraph op [namespace: odin-prime]
            PG[(PostgreSQL<br/>db: lorcana)]
        end
    end
    L[Lorcast API<br/>api.lorcast.com]
    N[ntfy.sh topic]

    B -->|http :30710| W
    C -->|http :30710 /api| W
    W -->|/api/ proxy| A
    A --> PG
    J1 --> PG
    J2 -->|seed catalog| L
    J2 --> PG
    CJ1 -->|prices| L
    CJ1 --> PG
    CJ2 --> PG
    CJ2 -->|push| N
    N --> P
```

**Key design points:**

- **Single entry point.** Only the web pod exposes a NodePort (**30710**). The
  browser, odin-mcp, and anything else all reach the API through nginx's
  same-origin `/api/` proxy. The API service is ClusterIP-only — never exposed
  directly. There is **no authentication** on the API; the security boundary is
  the LAN + cluster.
- **Shared PostgreSQL.** Database `lorcana` (owner role `lorcana`) lives on the
  shared odin-prime PostgreSQL (`postgresql.odin-prime.svc.cluster.local:5432`),
  browsable via pgAdmin at `:30880`.
- **Catalog from Lorcast.** The card catalog is seeded/refreshed from the
  [Lorcast API](https://lorcast.com/docs/api). Collection counts come from
  Dreamborn.ink scanner exports. **Core Constructed legality does NOT come from
  Lorcast** — Lorcast's `legalities` was verified stale (2026-08-05); we own the
  truth in `sets.core_legal` (see [§7.3](#73-annual-rotation-core_legal)).
- **Free-copy allocation.** Decks marked *in use* ("built") allocate their
  physical copies. Everything that answers "can I build this?" uses
  `free = owned − allocated_to_other_built_decks`, computed inline in SQL — so
  two built decks can never silently claim the same copies.

### Repo layout

```
lorcana/
├── api/            FastAPI app (Dockerfile, app/{main,config,db}.py)
│   └── app/
│       ├── routers/    cards, collection, imports, decks, matchlog (+ duels), stats, sim, brief
│       ├── services/   importer, matching, deck_import, snapshots, brief
│       └── jobs/       seed_catalog, refresh_prices, snapshot_collection, fetch_news, daily_brief, lorcast (client)
├── web/            React 18 + Vite + TypeScript SPA, nginx serving + /api proxy
├── db/migrations/  000–029 idempotent SQL migrations
├── deploy/         k8s manifests + apply.sh (namespace, secrets, jobs, cronjobs)
└── docs/           this guide
```

---

## 2. Quick reference

| Thing | Value |
|---|---|
| Web UI / API entry | `http://jason-holt-blade-18-rz09-0484.local:30710` (API under `/api`) |
| Health check | `GET http://jason-holt-blade-18-rz09-0484.local:30710/api/health` |
| pgAdmin | `http://jason-holt-blade-18-rz09-0484.local:30880` |
| MCP server (Claude) | `http://jason-holt-blade-18-rz09-0484.local:30720/mcp` (odin-mcp, HTTP transport) |
| Namespace | `lorcana` (Postgres in `odin-prime`) |
| Database | `lorcana` @ `postgresql.odin-prime.svc.cluster.local:5432`, role `lorcana` |
| Container registry | `localhost:30500` |
| API image | `localhost:30500/lorcana/api:fastapi-YYYYMMDD` |
| Web image | `localhost:30500/lorcana/web:nginx-YYYYMMDD` |
| Secrets | `lorcana-db` (DATABASE_URL, PGPASSWORD), `lorcana-ntfy` (LORCANA_NTFY_URL, optional) |
| CronJobs (all PT, explicit `timeZone`) | `lorcana-db-backup` (02:00), `lorcana-price-refresh` (05:00), `lorcana-collection-snapshot` (06:00), `lorcana-news-fetch` (07:30), `lorcana-daily-brief` (08:00) |
| Manual jobs | `lorcana-seed` (catalog refresh), `lorcana-migrate` (run by apply.sh) |
| Deploy script | `./deploy/apply.sh` |
| ntfy topic URL backup | `~/Projects/secrets/lorcana.ntfy.url.s` (never committed) |

**Most common operations, one-liners:**

```bash
# Full deploy (idempotent: secret if missing, bootstrap if missing, migrations, rollout)
./deploy/apply.sh

# Refresh card catalog after a new set release
kubectl -n lorcana delete job lorcana-seed --ignore-not-found
kubectl apply -f deploy/jobs/seed-job.yaml
kubectl -n lorcana logs -f job/lorcana-seed

# Run the price refresh right now (don't wait for tonight)
kubectl -n lorcana create job --from=cronjob/lorcana-price-refresh price-refresh-manual

# Send today's brief right now
kubectl -n lorcana create job --from=cronjob/lorcana-daily-brief brief-manual

# Tail API logs
kubectl -n lorcana logs -f deploy/lorcana-api
```

---

## 3. Setup & first-time install

### 3.1 Prerequisites

- k3s cluster with the local registry at `localhost:30500` and the odin-prime
  PostgreSQL deployment running (`kubectl -n odin-prime get deploy postgresql`).
- `buildah` on the build host; `kubectl` with cluster admin.
- Nothing else — the app has no external dependencies beyond Lorcast (catalog
  seeding) and optionally ntfy.sh (push).

### 3.2 Build & push images

```bash
cd ~/Projects/ODIN/lorcana

buildah bud --format docker -t localhost:30500/lorcana/api:fastapi-YYYYMMDD api/
buildah push --tls-verify=false localhost:30500/lorcana/api:fastapi-YYYYMMDD

buildah bud --format docker -t localhost:30500/lorcana/web:nginx-YYYYMMDD web/
buildah push --tls-verify=false localhost:30500/lorcana/web:nginx-YYYYMMDD
```

Then set the new tags in the manifests. **The API tag appears in SIX files**
(the deployment plus every job that runs `python -m app.jobs.*`):

- `deploy/api/deployment.yaml`
- `deploy/jobs/seed-job.yaml`
- `deploy/jobs/price-refresh-cronjob.yaml`
- `deploy/jobs/daily-brief-cronjob.yaml`
- `deploy/jobs/news-fetch-cronjob.yaml`
- `deploy/jobs/collection-snapshot-cronjob.yaml`

(`db-backup-cronjob.yaml` uses the odin-prime postgres image, not the API
image.) The web tag appears only in `deploy/web/deployment.yaml`. **Never
reuse a tag** — `imagePullPolicy: IfNotPresent` means a reused tag silently
runs the node's cached image; use date + session-distinct suffixes.

### 3.3 Run apply.sh

```bash
./deploy/apply.sh
```

What it does, in order (all idempotent — safe to re-run any time):

1. **Namespace** — applies `deploy/namespace.yaml` (namespace `lorcana`).
2. **Secret `lorcana-db`** — created **only if missing**. Password comes from
   `$LORCANA_DB_PASSWORD` if set, else `openssl rand -hex 24`. Writes two keys:
   `DATABASE_URL` (full psycopg URL) and `PGPASSWORD` (for the migrate job's
   psql). An existing secret is never touched — the password is stable across
   redeployments.
3. **One-time DB bootstrap** — if database `lorcana` doesn't exist on the
   odin-prime Postgres, pipes `db/migrations/000_role_db.sql` into `psql` via
   `kubectl exec` (creates role + database; also re-syncs the role password to
   the secret's value when re-run).
4. **`kubectl apply -k .`** — deployments, services, and both CronJobs via
   kustomize.
5. **Migrations ConfigMap** — recreates `lorcana-migrations` from
   `db/migrations/0*.sql`, **excluding** `000_role_db.sql` (that one is
   admin-only and already handled in step 3).
6. **Migrate Job** — deletes any old `lorcana-migrate` job, applies
   `jobs/migrate-job.yaml`, waits up to 120 s for completion. All migrations
   001+ are `IF NOT EXISTS`-idempotent and re-applied on every deploy. On
   failure the script prints the last 50 log lines and exits nonzero.
7. **Rollouts** — waits for `lorcana-api` then `lorcana-web`.

### 3.4 Seed the catalog

The migrate job creates empty tables; the catalog comes from Lorcast:

```bash
kubectl -n lorcana delete job lorcana-seed --ignore-not-found
kubectl apply -f deploy/jobs/seed-job.yaml
kubectl -n lorcana logs -f job/lorcana-seed
```

The seed upserts all sets and every card print (name, version, cost, ink(s),
inkwell, type, classifications, keywords, body/flavor text, strength, willpower,
lore, **move_cost** for locations, rarity, images, prices, legalities, raw
JSON). It also auto-creates three `set_aliases` per set (lowercased code,
numeric form, lowercased name) for the Dreamborn importer. Idempotent — rerun
freely, and rerun **after every new set release** (see §6.3).

### 3.5 Import your collection

Export from the Dreamborn.ink scanner app and upload on the **Upload** page
(see §9.4). First upload: use **Replace** mode with **Preview (dry run)** first.

### 3.6 Optional: daily brief push (ntfy)

Without the `lorcana-ntfy` secret, the 8am brief is log-only (visible in Loki
and pod logs). To get it on your phone:

```bash
URL="https://ntfy.sh/odin-lorcana-$(openssl rand -hex 8)"
echo "$URL" > ~/Projects/secrets/lorcana.ntfy.url.s
kubectl -n lorcana create secret generic lorcana-ntfy --from-literal=LORCANA_NTFY_URL="$URL"
```

Then subscribe to the topic in the ntfy phone app. The topic name **is** the
password (public ntfy.sh), so it must be unguessable and never committed. The
CronJob references the secret with `optional: true`, so its absence is fine.
Rotation = same three commands with a fresh random suffix, then delete the old
secret first (`kubectl -n lorcana delete secret lorcana-ntfy`) and re-subscribe
on the phone.

---

## 4. Configuration reference

### 4.1 API environment variables (`api/app/config.py`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://lorcana:lorcana@localhost:5432/lorcana` | psycopg3 pool (min 1 / max 5 connections). In-cluster value comes from the `lorcana-db` secret. |
| `LORCAST_BASE` | `https://api.lorcast.com/v0` | Lorcast API base for seed/price jobs. |
| `LORCAST_DELAY_S` | `0.25` | Politeness sleep before every Lorcast request. |
| `LORCANA_NTFY_URL` | *(unset)* | Read by `daily_brief` only. Unset ⇒ log-only brief. |
| `LORCANA_HOME_LAT` / `LORCANA_HOME_LON` | *(unset)* | Home coords for nearest-first venue sorting. Env-only by design (privacy — set in the `lorcana-db` secret, never in the repo). Unset ⇒ venues sort A-Z. |
| `LORCANA_NEXT_ROTATION` | *(unset)* | Next Core rotation date (ISO). Set when announced; the brief shows a countdown (⚠ inside 90 days). |

### 4.2 Kubernetes secrets

| Secret | Keys | Created by | Notes |
|---|---|---|---|
| `lorcana-db` | `DATABASE_URL`, `PGPASSWORD` | `apply.sh` (once) | Password only lives here; `secret.example.yaml` is a template, never the real thing. API + all jobs use `envFrom`. |
| `lorcana-ntfy` | `LORCANA_NTFY_URL` | manual (§3.6) | Optional. Topic URL also backed up at `~/Projects/secrets/lorcana.ntfy.url.s`. |

### 4.3 Resources & probes

| Workload | Requests | Limits | Probes |
|---|---|---|---|
| lorcana-api | 50m / 128Mi | 500m / 256Mi | readiness+liveness `GET /api/health:8000` (runs `SELECT 1`) |
| lorcana-web | 25m / 32Mi | 250m / 128Mi | readiness+liveness `GET /:80` |
| migrate / brief jobs | 25m / 32–64Mi | 250m / 128Mi | — |
| seed / price jobs | 50m / 128Mi | 500m / 256Mi | — |

### 4.4 nginx proxy (`web/nginx.conf`)

- `location /api/` → `http://lorcana-api.lorcana.svc.cluster.local:8000`, using
  a **variable proxy_pass with `resolver 10.43.0.10`** so nginx starts even if
  the API is down (you get a 502 instead of a crashloop).
- `client_max_body_size 10m` — matches the API's 10 MiB import cap; raise both
  together or not at all.
- `proxy_read_timeout 120s` (imports can be slow), SPA fallback to
  `/index.html`, 30-day immutable caching on `/assets/`.

### 4.5 MCP side (odin-mcp)

- `ODIN_LORCANA_URL` (default `http://$ODIN_NODE:30710`, node default
  `jason-holt-blade-18-rz09-0484.local`) — the MCP talks to the same NodePort/nginx proxy as the
  browser. No separate credentials.
- Lorcana tools live in one file:
  `odin-mcp/odin_mcp/tools/lorcana.py`. Deploying a change = rebuild odin-mcp
  image (`localhost:30500/odin/odin-mcp:http-YYYYMMDD`), bump the tag in
  `odin-mcp/deploy/manifests.yaml`, `kubectl apply` (see odin-mcp README).

---

## 5. Redeployment options

Pick the smallest hammer:

| Change | What to do |
|---|---|
| **API code** (`api/app/**`) | Build+push new api image → bump tag in **all six** files (§3.2) → `kubectl apply -f deploy/api/deployment.yaml` (or full `apply.sh`). CronJobs pick the new tag up on their next run. |
| **Web UI** (`web/src/**`) | Build+push new web image → bump tag in `deploy/web/deployment.yaml` → `kubectl apply -f deploy/web/deployment.yaml`. Hard-refresh the browser (assets are content-hashed, `index.html` is not cached). |
| **New migration** (`db/migrations/NNN_*.sql`) | Write it idempotent (`IF NOT EXISTS` / guarded `UPDATE`) → `./deploy/apply.sh` (steps 5–6 rebuild the ConfigMap and rerun the migrate job). No image rebuild needed. |
| **Schedule / job spec** | Edit the yaml → `kubectl apply -k deploy/` (or `apply.sh`). |
| **MCP tool change** | See §4.5 — separate repo, separate image, separate deploy. |
| **Everything / not sure** | `./deploy/apply.sh` — it is fully idempotent. |
| **Roll back** | Set the previous image tag back in the yaml and `kubectl apply` it. Old tags stay in the registry. Migrations are forward-only — write a new compensating migration rather than editing an applied one. |

**Restart without redeploy** (e.g. to clear a wedged DB pool):
`kubectl -n lorcana rollout restart deploy/lorcana-api`.

**Local web development:** `cd web && npm install && npm run dev` — the Vite dev
server proxies `/api` to the deployed NodePort, so you develop the UI against
real data without running the API locally.

---

## 6. Scheduled jobs & data refresh

### 6.1 CronJob: `lorcana-price-refresh` — nightly 05:00 PT

Runs `python -m app.jobs.refresh_prices`. Updates `price_usd`,
`price_usd_foil`, `legalities`, `raw` on existing cards **and appends one
`price_history` row per card**. It updates only — a brand-new card is skipped
until the seed job has inserted it.

The brief's *price movers* section needs **at least two** history snapshots per
card, so it stays empty until the second nightly run after setup. (The first
snapshot was seeded manually 2026-08-06.)

Price history also powers **Stats-page trends**: `GET /stats/value-history`
(today's collection valued at each daily snapshot) and
`GET /stats/movers?days=30|90` (top owned-card gainers/losers; falls back to
the oldest snapshot while history is shorter than the window), plus per-card
sparklines on card detail (`price_history` in the card payload).

### 6.2 CronJob: `lorcana-news-fetch` — daily 07:30 PT

Runs `python -m app.jobs.fetch_news`, half an hour before the brief so fresh
items land in the morning push. Scrapes the official
[disneylorcana.com news page](https://www.disneylorcana.com/en-US/news)
(Ravensburger; server-rendered Nuxt markup, parsed with regexes — no headless
browser) and upserts into `news_items`: title, category (News / Gameplay /
Events / Strategy…), summary, image, published date. The URL is the identity;
refetches update text in place, `first_seen_at` is set once.

- The brief JSON carries the latest 8 items with an `is_new` flag
  (`first_seen_at` within 36 h); the **text push and MCP brief list only new
  items**, so unchanged news doesn't repeat every morning. The web Brief page
  shows all 8 with NEW badges.
- The job **fails loudly if a 200 page parses to zero items** — that means a
  site redesign broke the selectors; fix the regexes in
  `api/app/jobs/fetch_news.py` (`CARD_RE` / `FIELD_RES`).
- To add another official channel, append a `(name, url, parser)` tuple to
  `SOURCES` in the same file.
- Manual run: `kubectl -n lorcana create job --from=cronjob/lorcana-news-fetch news-manual`.

**Enrichment (mig 014):** items whose title/summary matches rotation, banlist,
errata, or release-notes keywords get `signal='rules'` and their article body
fetched once (capped 12k chars, stored in `news_items.body`). The job also
diffs Lorcast's set list against ours — an unknown set becomes a synthetic
`signal='new-set'` item saying "run the seed job" (keyword-free, so a new-set
announcement is never missed). Signal items lead the news list for 7 days,
carry ⚠ RULES / ⚠ NEW SET badges on the web brief, and get a ⚠ prefix in the
ntfy push.

### 6.3 CronJob: `lorcana-daily-brief` — daily 08:00 PT

Runs `python -m app.jobs.daily_brief`: builds the brief (tonight's league from
the venue registry, week schedule, last-event recap + "one change" reminder,
local meta from last 5 events, dead-card watch, price movers ≥ $0.50 on owned
cards, collection totals), prints it to logs (→ Loki), and pushes to ntfy if
the secret exists. Same content as `GET /api/brief`, the **Brief** web page,
and the `lorcana_brief` MCP tool.

All CronJobs carry an explicit `timeZone: America/Los_Angeles` (added
2026-08-18 after discovering the controller was interpreting bare schedules
in host-local time, which had the brief firing at 15:00 instead of 08:00) —
schedules are written in PT and are DST-stable. Both CronJobs use
`concurrencyPolicy: Forbid`.

### 6.4 CronJob: `lorcana-collection-snapshot` — daily 06:00 PT

Runs `python -m app.jobs.snapshot_collection`: appends one
`collection_snapshots` row — total copies, unique cards, value, and
rarity/ink/set/type/cost breakdowns (JSONB) — an hour after the price
refresh, so each day's snapshot values the collection at that morning's
prices. Idempotent per day. A second snapshot (`source='import'`) is written
by every real (non-dry-run) upload at its exact timestamp, so upload jumps
chart where they actually happened. Feeds the Stats page's "Collection over
time" panel (`GET /stats/snapshots`). Historical totals were backfilled from
the `imports` audit trail (mig 020) — those rows have no value/breakdown and
the charts skip them for the metrics they lack.

### 6.5 CronJob: `lorcana-db-backup` — nightly 02:00 PT

`pg_dump -Fc` with verify-before-prune, local 30-day + Synology NAS 60-day
retention, and ntfy alert on failure — full detail and restore procedures in
§7.1.

### 6.6 Runbook: new set release

1. `kubectl -n lorcana delete job lorcana-seed --ignore-not-found && kubectl apply -f deploy/jobs/seed-job.yaml` — pulls the new set + cards.
2. Check whether the new set should be Core-legal; if the rotation window
   changed, update `db/migrations/009_core_legal_sets.sql` and run `apply.sh`
   (see §7.3).
3. If Dreamborn labels the new set unusually and imports report
   `unknown set '...'`, add an alias (§7.4).
4. Prices for the new cards appear after the next nightly price refresh (or run
   it manually, §2).

---

## 7. Database administration

### 7.1 Access

```bash
# psql into the lorcana DB (password prompt: it's in the lorcana-db secret)
kubectl -n odin-prime exec -it deploy/postgresql -- psql -U lorcana -d lorcana

# read the app password
kubectl -n lorcana get secret lorcana-db -o jsonpath='{.data.PGPASSWORD}' | base64 -d
```

Or browse via pgAdmin at `:30880` (server: `postgresql.odin-prime.svc`, db
`lorcana`, role `lorcana`).

**Backups (automated):** the `lorcana-db-backup` CronJob
(`deploy/jobs/db-backup-cronjob.yaml`) runs nightly at 02:00 PT and writes a
compressed `pg_dump -Fc` to **`/mnt/lvm_k3s/backups/lorcana/`** on the host —
a hostPath outside every PVC/namespace lifecycle, so deleting k8s objects
cannot take the dumps with it. Each run verifies the dump (size + `pg_restore
--list` table count) *before* pruning anything, keeps 30 days, and pushes an
ntfy alert on failure (via the optional `lorcana-ntfy` secret). Run one now:

```bash
kubectl -n lorcana create job bk-now --from=cronjob/lorcana-db-backup
kubectl -n lorcana logs -f job/bk-now
```

**Restore** (verified 2026-08-17 — restores to identical row counts). To
inspect a dump or recover data without touching the live DB, restore into a
scratch database first:

```bash
DUMP=/mnt/lvm_k3s/backups/lorcana/lorcana-YYYYMMDD-HHMMSS.dump
kubectl -n odin-prime exec deploy/postgresql -- \
  psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE lorcana_restore_test"
kubectl -n odin-prime exec -i deploy/postgresql -- \
  pg_restore -U "$POSTGRES_USER" -d lorcana_restore_test --no-owner < "$DUMP"
# ...inspect / copy rows across, then:
kubectl -n odin-prime exec deploy/postgresql -- \
  psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE lorcana_restore_test"
```

Full disaster restore (replaces the live DB — scale the API down first):

```bash
kubectl -n lorcana scale deploy/lorcana-api --replicas=0
kubectl -n odin-prime exec -i deploy/postgresql -- \
  pg_restore -U "$POSTGRES_USER" -d lorcana --clean --if-exists --no-owner < "$DUMP"
kubectl -n lorcana scale deploy/lorcana-api --replicas=1
```

**Off-host copies (automatic):** after the local dump verifies, the same job
copies any new dumps to the Synology NAS (freya-syn1618, 192.168.1.26) at
**`/mnt/nas/odin-storage/k3s-backups/lorcana/`** via the NFS share already
mounted on the node — atomic tmp+rename copies, 60-day retention there (vs
30 local). The job checks `/proc/mounts` first: if the NAS export isn't
actually mounted it alerts and fails *visibly* instead of silently writing
to the local mountpoint directory — the local dump has already landed by
then, so a NAS outage never costs a backup. Disk-loss protection therefore
covers everything except simultaneous loss of both machines.

The catalog is always recoverable from Lorcast via the seed job; the
irreplaceable data is `collection`, `decks`/`deck_cards`, the match log
(`events`, `matches`, `games`, `observations`), `venues`, `imports`, and
`price_history`.

### 7.2 Schema at a glance

| Table | Purpose / key columns |
|---|---|
| `sets` | Lorcast sets. `code` unique ('1'…'13', 'P1', 'P2', …), `set_num` (Dreamborn match key), **`core_legal`** (our rotation truth, mig 009). |
| `set_aliases` | Normalized Dreamborn set-label → set mapping. Auto-rows from seed + hand rows from mig 002. |
| `cards` | One row per print. `full_name` is GENERATED (`name - version`). Stats: `cost`, `inkwell`, `strength`, `willpower`, `lore`, `move_cost` (locations). `ink` = primary ink; `inks text[]` (mig 003) is what filters use (dual-ink, set 13+). Prices + `price_usd_foil`, `legalities` (Lorcast's — informational only), `raw` jsonb. Unique `(set_id, collector_number)`. |
| `collection` | `card_id` PK, `qty_normal`, `qty_foil`. Absolute counts. |
| `imports` | Audit of every upload incl. dry runs: sha256, mode, matched/unmatched rows (jsonb), summary — plus `note` (annotate uploads, e.g. "sealed winnings") and `diff` (per-card before→after, mig 019). |
| `decks` / `deck_cards` | `decks.name` unique; `in_use` (mig 008) drives copy allocation; `format` ∈ constructed/sealed (mig 011); `wanted` want-list flag (mig 013); `sim_only` opponent decks (mig 016); `strategy` archetype label (mig 022); provenance `created_source`/`updated_source` ∈ api/webui/mcp/scout (mig 004). `deck_cards.qty > 0`; the 4-copy rule is a UI/export warning, not a DB constraint. |
| `deck_events` | Deck lifecycle audit (mig 015): created/cloned/built/unbuilt/pool/scouted with reasons — answers "where did my copies go". Cascade-deletes with the deck — deletions survive in `deck_tombstones` instead. |
| `deck_tombstones` | One row per deleted deck (mig 029): name, metadata, and the FULL card list (jsonb) — a recoverable archive; the Decks page lists them under "deleted decks". |
| `deck_pool` | Sealed decks only (mig 011): the cards opened from packs, grows weekly in a league. Sealed decks validate/build against their pool, never the collection, and are excluded from `in_use` allocation. |
| `events` | One tournament night: date, venue (`venue_id` FK preferred; `store` text fallback), deck + version, rounds/players/entry, **`event_type`** ∈ sanctioned/practice/casual (mig 027 — keeps practice bot games out of filtered stats), post-event fields (`final_record`, `packs_won`, `promo`, `biggest_problem`, `one_change`). |
| `matches` / `games` | Per round: opponent, result CHECK ('2-0','2-1','1-2','0-2','1-0','0-1','DRAW','BYE' — single-game results for duels.ink, mig 024), opp inks + shape; per game: play/draw, won, `loss_mode` ('race','board','flood','screw','time','na'). Unique `(event_id, round)`. |
| `observations` | Attached to a match **xor** an event (CHECK). Kinds: `threat_card`, `tag`, `my_dead_card`, `my_mvp`, `never_drew`, `always_dead`. Feeds the cut list and brief. |
| `venues` | Stable `slug` (never delete — set `active=false`), display_name, coords (nearest-first sort from home), `event_night`/`event_time` (drives the brief's "tonight"). Seeded with 12 Bay Area stores (mig 006). |
| `price_history` | Append-only nightly snapshots per card (~3.2k rows/night) (mig 007). Feeds price movers. |
| `news_items` | Official news scraped daily from disneylorcana.com (mig 010). `url` unique; `first_seen_at` drives the brief's NEW flag. |
| `collection_snapshots` | Daily + per-import collection state (migs 019/020): totals, value, rarity/ink/set/type/cost breakdowns (JSONB). Backfilled rows (from `imports`) carry totals only. Feeds the Stats history charts. |
| `sim_results` / `sim_deck_runs` | Sim engine (migs 012/013/017/021, Lorcana-Sim repo): nightly matchup aggregates / per-deck runs with status, win rates, analysis JSONB. |
| `engine_coverage` | Which printings the sim engine plays faithfully (mig 018); published by the engine's export tool. |
| `duels_game_logs` | Full duels.ink game logs (mig 025): raw text + parsed plays/quests/lore/impact/undo_counts per seat, plus **quarantine** (`corpus_excluded`/`exclude_reason`, mig 027) — logs whose own lore bookkeeping is inconsistent (duels.ink tracking bugs) stay stored but are skipped by the replay corpus. FKs SET NULL — deleting events/matches never destroys game data. |
| `replay_validations` | Engine replay verdicts per game per build (mig 026): ok/divergences — real games as regression tests. |

Allocation ("free copies") is **not** a view — it's inline SQL in
`api/app/routers/cards.py` and `decks.py`:
`allocated = Σ deck_cards.qty across in_use decks`, `free = max(0, owned − allocated_elsewhere)`.

### 7.3 Annual rotation (`core_legal`)

Core Constructed legality is owned by `sets.core_legal`, set in migration
`009_core_legal_sets.sql` (currently `set_num BETWEEN 9 AND 13`). **At each
annual rotation (next ~July 2027): edit the range in 009 and run
`./deploy/apply.sh`.** Deck exports show both our verdict and Lorcast's
(`lorcast_says`) for contrast; trust ours.

When Ravensburger announces the rotation date, set `LORCANA_NEXT_ROTATION`
(e.g. patch it into the `lorcana-db` secret) — the brief counts down and turns
⚠ inside 90 days. Legality is surfaced everywhere: ⟳ badges in the card
browser (+ a "Core-legal only" filter), a legality line on card detail, a
banner on deck pages, the export sheet, and `[NOT CORE-LEGAL]` markers in MCP
card lines.

### 7.4 Set aliases (import says `unknown set`)

The importer resolves a file's set label via `set_aliases` first, then numeric
`set_num`. When Dreamborn invents a new label, add a row to
`db/migrations/002_set_aliases_seed.sql` following the existing pattern
(`'promo'→P1`, `'promo 2'→P2`), then run `apply.sh`. Aliases are normalized
`lower(trim())`.

---

## 8. Troubleshooting

| Symptom | Check / fix |
|---|---|
| Web UI up but every page errors | `curl http://jason-holt-blade-18-rz09-0484.local:30710/api/health` — if not `{"status":"ok"}`, the API can't reach Postgres. `kubectl -n lorcana logs deploy/lorcana-api`; check odin-prime Postgres is up. |
| 502 from `/api/` | API pod down/not-ready (nginx is designed to 502 rather than crash). `kubectl -n lorcana get pods`, check readiness probe (it needs a working DB). |
| Upload rejected 413 | File over 10 MiB (nginx and API both cap). Split the export. |
| Upload 409 "already merged" | Duplicate-file guard on **merge** mode (same sha256 as a previous non-dry-run import). Use the "Merge anyway" button (force) or Replace mode, which is idempotent and never blocked. |
| Rows unmatched: `unknown set '…'` | Add a set alias (§7.4). |
| Rows unmatched: `ambiguous name` | The set-scoped name fallback found duplicates; fix the row's card number in the CSV (matching never guesses). |
| Migrate job failed on apply.sh | Script prints the last 50 psql lines. Fix the SQL (must be idempotent), re-run `apply.sh`. |
| New set missing from UI | Seed job hasn't run — §3.4. |
| New cards have no prices | Price refresh only updates cards it already knows and runs nightly at 05:00 PT; run it manually (§2) after seeding. |
| Brief has no price movers | Needs ≥2 daily `price_history` snapshots per card, and only shows owned-card moves ≥ $0.50. |
| No ntfy push | Secret `lorcana-ntfy` missing (job logs say "log-only"), or phone unsubscribed after a rotation. `kubectl -n lorcana logs job/<latest brief job>`. |
| Brief "tonight" always empty | Venues need `event_night`/`event_time` set — `PUT /api/venues/{slug}` or via psql. |
| Deck says not buildable but I own the cards | Copies are allocated to *other* built decks. Check the card detail page ("N allocated to built decks · M free"), or un-mark the other deck. Force-building is available but means physically sharing copies. |
| MCP tools failing | odin-mcp is a separate deployment: `kubectl -n odin-mcp get pods`, and it reaches this app via `:30710` like everyone else. |

Logs land in Loki with `ai.odin.loki.app_category: lorcana`.

---

## 9. Web UI user guide

Base URL `http://jason-holt-blade-18-rz09-0484.local:30710`. Nav bar: **Cards · Stats · Decks ·
Matches · Brief · Upload**.

**Install on your phone**: open the site in Safari/Chrome and *Add to Home
Screen* — it installs as a standalone app (gold ◈ icon, dark theme). The UI is
touch-optimized: the match-log toggles get bigger tap targets on touch screens
and tables scroll horizontally.

**Off-network access** runs through a Cloudflare Tunnel (the existing swrpg
`cloudflared` reaches `lorcana-web.lorcana.svc:80` cross-namespace — nothing
lorcana-side to deploy) with a **Cloudflare Access** self-hosted app in front
(email OTP allow-list) plus JWT enforcement on the tunnel route. The public
hostname deliberately lives only in the `lorcana-db` secret as
`LORCANA_WEB_URL` (never in this public repo); the brief's ntfy tap-through
links use it. LAN NodePort 30710 stays as-is — no auth friction at home, and
odin-mcp/CronJobs never leave the cluster. Reinstall the PWA from the public
URL to use it at venues.

### 9.1 Cards (`/`)

Browse the full catalog joined with your collection.

- **Filters:** free-text search (card name *or* rules text), set, ink, rarity,
  Owned + missing / Owned only / Missing only, and a **Core-legal only**
  checkbox. Search is debounced; 60 cards per page with a pager.
- Rotated (non-Core) cards carry a ⟳ marker on their tile and a red legality
  line on the detail page.
- **Tiles:** card image, count badges (normal, `✦N` foil, `◈N` allocated to
  built decks), ink dots, set·number, rarity. Unowned cards are dimmed.
- Click any card for the detail page.

### 9.2 Card detail (`/cards/{set}/{number}`)

Full stats (cost + inkable `◉`, strength, willpower, lore — and move cost for
locations), rules and flavor text, prices (normal + foil), an **In decks**
panel (which decks use it, `◈ built` markers, allocated vs free copy counts),
and an **In collection** panel with −/+ steppers for normal and foil counts —
this is the manual way to adjust quantities without a re-import.

Below it, a **Want it** panel adds the card straight to a named want list: a
dropdown of existing lists plus **➕ New list…** to create one inline; each
Add stacks another copy (current qty is read first, so repeat clicks go
1x → 2x → 3x). Named lists are managed on the Want List page (§9.5); the
deck-derived aggregate list is computed from wanted-deck shortfalls and is
not directly addable here.

### 9.3 Stats (`/stats`)

Collection totals (unique owned / catalog size, normal + foil copies,
estimated value), then the **Collection over time** panel driven by
`collection_snapshots`:

- **Metric toggles are multi-select** — Value ($), Total copies, Unique cards
  each render their own stacked chart.
- **Breakdown toggles** (Total / rarity / ink / set / card type / ink cost)
  apply to every visible chart. A breakdown with fewer than two snapshot
  points renders as a **current-composition bar chart** until trend history
  accrues (pre-feature backfill only recorded totals).
- **Timescale toggles**: Week / Month (default) / 3 months / 6 months / Year
  / All. Import snapshots appear as dotted markers — hover for the upload
  note.

Below it: **price movers** tables (owned-card gainers/losers, 30/90-day
toggle) and a panel per set with completion % bar, playset progress (4+
copies), copy count, and set value. Card detail pages get nightly price
sparklines (normal + foil) once a card has two snapshots.

### 9.4 Upload (`/upload`)

Import Dreamborn.ink scanner exports (CSV or .xlsx, both header shapes are
auto-detected: variant rows `Set Number, Card Number, Variant, Count, Name`, or
legacy `Name, Normal, Foil, Set, Card Number`).

- **Replace collection** (default) — full snapshot: zeroes everything, then
  sets the file's counts. Idempotent; the normal workflow for full-collection
  exports. If the file would *lower or drop* cards you own, a
  **replace-losses warning table** shows exactly what — a partial export
  uploaded in Replace mode is the classic mistake; use Merge or re-scan.
- **Merge** — adds counts on top (for partial scans). Re-merging the same
  exact file is refused with a "Merge anyway" (force) escape hatch.
- **Always click "Preview (dry run)" first** — full matching report and
  projected totals, zero writes.
- The report lists every unmatched row with its reason (unknown set, no such
  number, ambiguous name); unmatched rows are never guessed. Import history at
  the bottom is the `imports` audit table.
- **Notes & diffs:** an optional note field annotates the upload ("additional
  cards from sealed competition"); every import (dry runs included) records a
  per-card before→after **diff**. In history, click a row's change count to
  expand the diff, click the Note column to annotate after the fact.
- **Sealed extraction:** when an import added cards, the diff offers
  **⧉ Copy added cards** (clipboard text list) and a sealed-deck picker with
  **→ Add to sealed pool** — pushes exactly the positive deltas into that
  deck's pool (`POST /imports/{id}/to-pool`), the league-night workflow:
  scan packs → Merge upload with a note → push the diff into the pool.
- Every real import also writes a `collection_snapshots` row at its exact
  timestamp, so the Stats chart shows the jump where it happened.

### 9.5 Decks (`/decks`, `/decks/{id}`)

- **The deck list is a sortable table**: # (deck id — what sim tools
  reference), name (→ detail), type (constructed/sealed/sim), card count,
  ink dots, an inline **strategy** dropdown (Aggro/Rush/Midrange/Tempo/
  Control/Combo/Ramp/Damage/Mill/Toolbox/Other), an inline **notes** field
  (saved on blur/Enter via `PATCH /decks/{id}/meta`), and a **⬇ CSV**
  download per deck (Dreamborn-compatible variant-row schema — imports
  straight back into Dreamborn.ink or our own Upload page). Click any header
  to sort ascending/descending.
- **Create:** empty deck by name, or paste a Dreamborn text list
  (`4 Elsa - Spirit of Winter` per line) and import. Name matching prefers a
  print you own, then a **Core-legal** print, then earliest release (promo
  prints often predate the main set — without the Core preference an unowned
  promo match falsely flags decks non-Core).
- **Sim-only decks** (mig 016): check "Sim-only" when importing an opponent
  netdeck to run simulations against — no ownership/buildable checks, can't be
  built or want-listed, SIM badge everywhere. Toggle on the deck page. Pick the format at
  creation: **Constructed** (60 cards, ≤4 per name, ≤2 inks) or **Sealed /
  limited** (minimum 40 cards, no copy/ink limits — Lorcana limited rules).
- **Sealed decks** get a SEALED badge and a **pool panel**: paste each week's
  pulls and they accumulate; the deck validates and builds against the pool
  (rows go red when the deck uses cards not in the pool), never against your
  collection — and marking a sealed deck built never allocates collection
  copies, since pack cards are separate physical cards.
- **Deck detail:** add cards via live search — filterable by ink, type,
  **Core-legal** (default on), and **free copies only** (owned copies not
  allocated to built decks); results show ink dots, cost, and free count.
  Per-card −/+ qty (⚠ above 4 copies), owned and **free** columns (short rows
  highlighted); remove with ✕. Every edit saves immediately.
- **Live composition panel:** cost-curve bars, per-ink counts, type breakdown,
  inkable/uninkable split, avg cost, and total character lore — updating with
  every edit (the same analysis the export sheet shows, without leaving the
  builder).
- **Buildable check:** green ✔ when the deck is coverable from free copies,
  red ✘ with the exact shortfall **and cost to complete** (missing copies ×
  current prices). Validation warnings (60 cards, ≤4 per name, ≤2 inks,
  dual-ink fit) show as ⚠ lines — warnings, not blocks.
- **Want list:** unbuilt constructed decks get a ☆ **Add to want list** button.
  The **Want List** page (linked from Decks) aggregates every missing copy
  across flagged decks — on top of what built decks already allocate, so it's
  the true "make everything buildable simultaneously" shopping list — priced
  per card, biggest ticket first. Per-row ✕ removes a card ("bought it") with
  a restore link; **Clear want list** unflags every deck at once. Two copy
  buttons: plain text, and **Copy for TCGplayer** — Mass Entry lines with the
  printed card code ("4 Elinor - Renowned Diplomat (86/204)"), which is the
  identity TCGplayer product names carry, so pasting into
  tcgplayer.com/massentry matches where bare names fail. Below it, **named
  want lists** (mig 028) organize wants by purpose ("Want for Rainbow Hunny",
  "Foils"): create ad-hoc lists, add cards by name (standard printing
  preferred over Enchanted/Epic reprints), or link a deck so the list tracks
  its live shortfall automatically. Agents manage the same lists via
  `lorcana_want_edit`.
- **Mark built / in use:** allocates the deck's copies. If the missing copies
  are sleeved in **other built decks**, the dialog lists those donor decks and
  offers to **pull** — one click un-builds the donors (their recipes stay
  intact; a cannibalized deck is honestly "not built") and builds this one.
  That's the on-the-fly rebuild workflow: recipes never change, `in_use`
  tracks physical reality. Force remains for true shortfalls, but the DB then
  over-claims and the Decks page flags it. Un-marking is never blocked.
- **Duplicate as version:** clones the list/notes as a new unbuilt deck
  (auto-suggests "… v5"), so a rebuild preserves the old version's recipe and
  its match-log references.
- **History:** every deck page shows its lifecycle (`deck_events`, mig 015) —
  created/cloned/built/un-built, with reasons like "copies pulled for
  'Ruby/Steel v4'". Answers "where did my cards go" weeks later.
- **Over-allocation banner:** the Decks page (and a brief warning line) flags
  any card claimed by built decks beyond owned copies — the safety net for
  force-builds and unscanned precon cards (`GET /allocation-conflicts`).
- **Export / print** (`/decks/{id}/export`): printable tournament sheet
  (player/event/date blanks), Core Constructed legality verdict (our
  `sets.core_legal` truth, with per-card violations), full card table,
  composition (type counts, total lore, ink counts, inkable split, avg cost)
  and cost curve. Buttons: print, copy text list, download `.txt`
  (Dreamborn-compatible, re-importable), download `.csv`
  (`GET /decks/{id}/export.csv`, Dreamborn's own variant-row schema).

### 9.6 Match Log (`/matches`, `/matches/{id}`)

Tournament tracking. Standing rule (5.2): **fill between rounds, review before
pairings — never at the table.**

- **Start event:** date, venue (registry dropdown, nearest-first; "Other…" for
  free text), deck + version, rounds, players, entry fee.
- **Log round (~90 seconds):** opponent, result (2-0/2-1/1-2/0-2/DRAW/BYE,
  plus 1-0/0-1 for single-game online matches),
  their two inks, archetype shape (lore_rush/aggro/midrange/control/unclear),
  "they ran" tags, up to 4 threat cards, per-game play/draw + W/L with loss
  mode on losses (race/board/flood/screw/time), your dead card and MVP, and a
  one-liner. Re-logging a round offers overwrite.
- **Post-event ("fill in the car"):** final record, packs won, promo, cards
  never drawn, cards always dead, biggest repeated problem, and **one change
  for next week (one — not four)**.
- The event page is your pre-pairings review: every round with games,
  observations (⚔ threats, 💀 dead, ★ MVP), one-liners.
- **Everything is editable after the fact:** ✎ Edit on any round loads it back
  into the form (saving replaces that round atomically), and ✎ Edit event
  opens the header — date, venue, format, deck/version, rounds, players,
  entry fee — saved via a partial `PUT /events/{id}`.

This data feeds the **cut list** (cards never MVP, sorted by dead mentions —
MCP `lorcana_cut_list`), the **local meta** table (ink-pair frequencies +
losses), and the daily brief's deck watch.

**duels.ink (online play):** the venue registry includes `duels-ink`
("duels.ink (online)"), and pasting a duels.ink game log to any
MCP-connected Claude (`lorcana_import_duels_log`) files the match here as a
1-0/0-1 round with auto-detected seat, inferred opponent inks,
**impact-ranked** threat cards (banishes ×3, bounces ×3, lore swings,
draws — songs and items included), and the full turn log stored in
`duels_game_logs` for the sim-engine pipeline (§10). Both log dialects
parse — the copy-paste export and the timestamped bookmarklet capture
(timestamp-only lines become per-turn `undo_counts`). Events created by
imports are `event_type=practice`; the importer audits the log's own lore
bookkeeping and quarantines internally-inconsistent logs from the replay
corpus (duels.ink's tracker has been seen dropping sequences). Re-imports
are safe: identical retries no-op, `overwrite=True` replaces the round and
its stored log together. Default dates resolve in PT, not UTC.

**Match Stats** ("Win-rate analytics →" from the Match Log): overall record
and win rate, on-play vs on-draw, game 1 vs games 2–3, how games are lost
(loss-mode bars), vs opponent archetype, per-deck breakdown, and vs ink pairs
— filterable to a single deck. Backed by `GET /api/matchlog/stats`.

### 9.7 Brief (`/brief`)

The daily digest on demand: tonight's league night (from venue
`event_night`), week schedule, **official news** (latest 8 from
disneylorcana.com with NEW badges on items first seen in the last 36 h), last
event recap with your "one change" reminder, local meta (last 5 events),
dead-card watch for your last deck, owned-card price movers, and collection
totals. Identical content to the 8am push (the push includes only NEW news
items).

---

## 10. Claude / MCP tools

The `lorcana` domain in odin-mcp (`odin_mcp/tools/lorcana.py`) exposes the
whole system to Claude at `http://jason-holt-blade-18-rz09-0484.local:30720/mcp`. Deck-building
advice is grounded in actually-owned/free copies; the match log is designed to
be dictated conversationally between rounds.

| Tool | What it does |
|---|---|
| `lorcana_search` | Catalog search (name/rules text, set, ink, rarity, owned filter) with stats, price, owned counts per line. |
| `lorcana_card` | Full single-card detail by set + collector number. |
| `lorcana_collection_stats` | Collection totals + per-set completion/playsets/value. |
| `lorcana_missing` | Want-list: unowned cards in a set with rarity + price. |
| `lorcana_decks` / `lorcana_deck` | List decks / full deck with own-free-allocated per card, legality warnings, buildable verdict. |
| `lorcana_save_deck` | Import a text deck list (idempotent; `overwrite`, `strict` legality mode, `format` constructed/sealed); reports buildability. Never touches collection counts. |
| `lorcana_deck_pool` | Record opened packs into a sealed deck's pool (add or replace) — dictate your pulls after cracking packs. |
| `lorcana_deck_wanted` / `lorcana_want_list` | Flag decks to build; get the aggregated, priced shopping list + all named lists (`tcg=True` returns TCGplayer Mass Entry card-code lines). |
| `lorcana_want_edit` | Manage want lists: create_list/delete_list (optionally deck-linked), add/remove cards on named lists, skip/restore cards on the deck list, clear_deck_wants. |
| `lorcana_sim_run` / `lorcana_sim_runs` / `lorcana_sim_result` | Queue engine simulations (vs baselines or a sim-only opponent deck), list runs, and fetch results incl. the teacher pass (turning points of a typical loss) — coaching raw material. |
| `lorcana_sim_compare` / `lorcana_sim_coverage` | Compare two runs (Wilson CIs, paired McNemar, comparability gates) / whole-catalog engine coverage. |
| `lorcana_import_duels_log` | Paste a raw duels.ink game log (either dialect): parses winner/turns/lore/plays/impact + undo markers, auto-detects your seat, infers opponent inks, ranks threats by impact, files a 1-0/0-1 match under the day's duels.ink practice event, stores the full log (quarantined if internally inconsistent). `overwrite` replaces round+log; identical retries no-op; mvp/dead/tags/threat overrides inline. |
| `lorcana_coverage_priority` | Engine-authoring priority from REAL play: unspecced cards ranked by how often they hit the table in stored logs. |
| `lorcana_scout_deck` | Auto-draft a sim-only opponent deck from real games vs an ink pair (copy counts from max plays seen, engine-covered filler to 60); re-scouting updates in place. |
| `lorcana_sim_calibration` | Sim win rate vs real record per matchup, Wilson CIs both sides; DIVERGES when intervals don't overlap. |
| `lorcana_replay_status` | Replay-validation health per engine build + open divergences (see docs/SIM_ENGINE_HANDOFF.md). |
| `lorcana_export_deck` | Dreamborn text + composition + Core legality (points to the printable web sheet). |
| `lorcana_deck_in_use` | Mark built/not-built; 409 shortfall flow with `force` after user confirmation. |
| `lorcana_delete_deck` | Delete (confirm with the user first) — tombstoned with the full card list. |
| `lorcana_restore_deck` | Undo a delete: resurrect from the tombstone by the ORIGINAL deck id (new id assigned; refuses double-restores). |
| `lorcana_venues` | Venue registry with slugs, nights, times. |
| `lorcana_log_event` | Start an event (fuzzy venue + deck-name resolution → returns event id). |
| `lorcana_log_match` | Log a round from shorthand — games parse from text like `"G1 play W; G2 draw L race"`; inks, shape, tags, threats, dead/MVP cards. `overwrite=True` is a **full REPLACE** of the round; identical retries return success without writing. |
| `lorcana_events` / `lorcana_event` | Recent events / full pre-pairings review of one event. |
| `lorcana_match_stats` | Local meta: ink-pair frequencies, losses, known opponents (filter by store / last N events / `event_type`). |
| `lorcana_cut_list` | Evidence-based cuts: never-MVP cards ranked by dead mentions, plus proven MVPs. `event_type='sanctioned'` keeps practice bot-game evidence out. |
| `lorcana_brief` | The daily brief text on demand. |

---

## 11. API endpoint reference

All under `/api` at `:30710`. JSON unless noted. No auth.

| Method & path | Purpose |
|---|---|
| `GET /health` | `SELECT 1` liveness. |
| `GET /sets` | Sets + card counts. |
| `GET /cards` | Paged search: `q, set, ink, rarity, type, owned=all\|owned\|missing, sort=set\|name\|cost\|price, page, page_size≤100`. |
| `GET /cards/{set}/{number}` | Card detail + decks containing it + `qty_free`. |
| `PUT /collection/{card_id}` | Set absolute `{qty_normal, qty_foil}`. |
| `POST /imports` | Multipart upload: `file, mode=replace\|merge, dry_run, force, note`. 413 >10 MiB, 409 duplicate merge, 422 bad format. Real imports also snapshot the collection. |
| `GET /imports`, `GET /imports/{id}` | Import history / full report incl. unmatched rows + per-card diff. |
| `PATCH /imports/{id}` | Set/clear the upload note after the fact. |
| `POST /imports/{id}/to-pool` | Push the import's added cards (positive diff deltas) into a sealed deck's pool. |
| `GET /stats`, `GET /stats/sets` | Collection totals / per-set stats. |
| `GET /stats/snapshots?days=` | Collection snapshots (daily + per-import) with breakdowns — the Stats history charts. |
| `GET /stats/value-history` | Collection value at each daily price snapshot. |
| `GET /stats/movers?days=&limit=` | Top owned-card price gainers/losers over the window. |
| `GET /missing?set=` | Unowned cards in a set. |
| `GET /brief` | Structured brief + rendered `text`. |
| `GET/POST /decks`, `GET/PUT/DELETE /decks/{id}` | Deck CRUD (name unique; PUT replaces the whole card list). DELETE writes a tombstone first (`?source=webui\|mcp\|api`). |
| `GET /deck-tombstones`, `GET /deck-tombstones/{id}` | Deleted decks (mig 029) with full recipes — explains deck-id gaps (ids are never reused); detail carries the recoverable card list. |
| `POST /deck-tombstones/{id}/restore` | Resurrect a deleted deck as a NEW deck from the tombstone recipe (optional `name` when the original is taken; missing catalog cards skipped + reported; tombstone gains `restored_deck_id`). |
| `POST /decks/import` | Text list import: `overwrite`, `strict` (422 with warnings), idempotent (`unchanged`). |
| `GET /decks/{id}/buildable` | Free-copy check with per-card shortfalls (sealed decks: pool check instead). |
| `POST /decks/{id}/pool/import` | Add/replace a sealed deck's pool from a text list. |
| `DELETE /decks/{id}/pool/{card_id}` | Remove a card from a sealed pool. |
| `GET /decks/{id}/export` | Text list + composition + Core legality. |
| `GET /decks/{id}/export.csv` | Dreamborn-compatible CSV download (variant-row schema). |
| `PATCH /decks/{id}/meta` | Inline strategy/notes update (empty string clears). |
| `PUT /decks/{id}/in_use` | Toggle allocation; 409 lists donor decks + `after_pull_missing`; `pull_from_decks=true` un-builds donors, `force=true` overrides. |
| `POST /decks/{id}/clone` | Duplicate as a new unbuilt version. |
| `GET /allocation-conflicts` | Cards claimed by built decks beyond owned copies. |
| `GET/POST /events`, `GET/PUT/DELETE /events/{id}` | Event CRUD; PUT is the post-event partial update (replaces event-level observations when given). |
| `POST /events/{id}/matches` | Log a round (unique per round; `overwrite` replaces). |
| `DELETE /matches/{id}` | Delete a round. |
| `GET/POST /venues`, `PUT /venues/{slug}` | Venue registry (nearest-first; retire with `active=false`). |
| `GET /matchlog/ink-pairs` | Meta stats (`store`, `last_events`, `event_type`). |
| `GET /matchlog/cut-list?deck_id=` | Never-MVP / dead-mention analysis (`event_type` filter). |
| `GET /matchlog/stats?deck_id=` | Win-rate analytics (overall, play/draw, game no., loss modes, shapes, per deck; `event_type` filter). |
| `PUT /decks/{id}/wanted` | Flag/unflag a deck for the want list. |
| `GET /wantlist` | Aggregated, priced shopping list across wanted decks; skipped cards listed separately; `text` + `tcg_text` (TCGplayer Mass Entry card codes) exports. |
| `POST /wantlist/skips`, `DELETE /wantlist/skips/{card_id}` | Remove/restore one card on the aggregated list without unflagging decks. |
| `POST /wantlist/clear` | Unflag every wanted deck (empties the deck-derived list; skips kept). |
| `GET/POST /wantlists`, `DELETE /wantlists/{id}` | Named want lists ("Want for Rainbow Hunny"), optionally deck-linked — a linked list auto-includes that deck's live shortfall. |
| `PUT /wantlists/{id}/cards` | Upsert a card on a named list by id or name (standard printing preferred; qty=0 removes). |
| `POST/GET /duels/logs`, `GET/DELETE /duels/logs/{id}` | Store / list (`match_id` filter) / read / delete full duels.ink game logs (delete is used by overwrite re-imports). |
| `GET /duels/coverage-priority` | Cards seen in real games vs engine coverage, ranked by play frequency. |
| `POST /duels/scout` | Auto-draft a sim-only opponent deck from real games (`inks`, `shape`, `handle`, `save`, `covered_only`). |
| `GET /duels/replay-corpus` | Real-game corpus for the engine's replay validator (card_map + replayable flag; quarantined logs excluded unless `include_excluded`). |
| `POST /duels/replay-validations`, `GET /duels/replay-status` | Engine posts per-game verdicts / per-build health + divergences. |
| `GET /sim/calibration` | Sim vs real win rates per matchup, Wilson CIs, divergence verdicts. |
| `/sim/*` (runs, results, compare, coverage) | Sim-engine pipeline endpoints — see `api/app/routers/sim.py` and the Lorcana-Sim repo. |
