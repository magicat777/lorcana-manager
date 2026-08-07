# Lorcana Collection Manager — Admin & User Guide

Disney Lorcana TCG card database, collection manager, deck builder, and tournament
match log, running on the ODIN k3s cluster with Claude integration via odin-mcp.

*Last updated 2026-08-06. Source of truth is always the repo at
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
            CJ1[CronJob: price-refresh<br/>Mon 06:00]
            CJ2[CronJob: daily-brief<br/>15:00 UTC = 8am PT]
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
│       ├── routers/    cards, collection, imports, decks, matchlog, stats, brief
│       ├── services/   importer, matching, deck_import, brief
│       └── jobs/       seed_catalog, refresh_prices, daily_brief, lorcast (client)
├── web/            React 18 + Vite + TypeScript SPA, nginx serving + /api proxy
├── db/migrations/  000–009 idempotent SQL migrations
├── deploy/         k8s manifests + apply.sh (namespace, secrets, jobs, cronjobs)
└── docs/           this guide
```

---

## 2. Quick reference

| Thing | Value |
|---|---|
| Web UI / API entry | `http://192.168.1.154:30710` (API under `/api`) |
| Health check | `GET http://192.168.1.154:30710/api/health` |
| pgAdmin | `http://192.168.1.154:30880` |
| MCP server (Claude) | `http://192.168.1.154:30720/mcp` (odin-mcp, HTTP transport) |
| Namespace | `lorcana` (Postgres in `odin-prime`) |
| Database | `lorcana` @ `postgresql.odin-prime.svc.cluster.local:5432`, role `lorcana` |
| Container registry | `localhost:30500` |
| API image | `localhost:30500/lorcana/api:fastapi-YYYYMMDD` |
| Web image | `localhost:30500/lorcana/web:nginx-YYYYMMDD` |
| Secrets | `lorcana-db` (DATABASE_URL, PGPASSWORD), `lorcana-ntfy` (LORCANA_NTFY_URL, optional) |
| CronJobs | `lorcana-price-refresh` (Mon 06:00), `lorcana-news-fetch` (14:30 UTC), `lorcana-daily-brief` (15:00 UTC = 8am PT) |
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

# Run the price refresh right now (don't wait for Monday)
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

Then set the new tags in the manifests. **The API tag appears in FOUR files**
(the deployment plus every job that runs `python -m app.jobs.*`):

- `deploy/api/deployment.yaml`
- `deploy/jobs/seed-job.yaml`
- `deploy/jobs/price-refresh-cronjob.yaml`
- `deploy/jobs/daily-brief-cronjob.yaml`

The web tag appears only in `deploy/web/deployment.yaml`.

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
  `192.168.1.154`) — the MCP talks to the same NodePort/nginx proxy as the
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
| **API code** (`api/app/**`) | Build+push new api image → bump tag in **all four** files (§3.2) → `kubectl apply -f deploy/api/deployment.yaml` (or full `apply.sh`). CronJobs pick the new tag up on their next run. |
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

### 6.1 CronJob: `lorcana-price-refresh` — Mondays 06:00

Runs `python -m app.jobs.refresh_prices`. Updates `price_usd`,
`price_usd_foil`, `legalities`, `raw` on existing cards **and appends one
`price_history` row per card**. It updates only — a brand-new card is skipped
until the seed job has inserted it.

The brief's *price movers* section needs **at least two** history snapshots per
card, so it stays empty until the second weekly run after setup. (The first
snapshot was seeded manually 2026-08-06.)

Price history also powers **Stats-page trends**: `GET /stats/value-history`
(today's collection valued at each weekly snapshot) and
`GET /stats/movers?days=30|90` (top owned-card gainers/losers; falls back to
the oldest snapshot while history is shorter than the window), plus per-card
sparklines on card detail (`price_history` in the card payload).

### 6.2 CronJob: `lorcana-news-fetch` — daily 14:30 UTC

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

### 6.3 CronJob: `lorcana-daily-brief` — 15:00 UTC (8:00 PDT / 7:00 PST)

Runs `python -m app.jobs.daily_brief`: builds the brief (tonight's league from
the venue registry, week schedule, last-event recap + "one change" reminder,
local meta from last 5 events, dead-card watch, price movers ≥ $0.50 on owned
cards, collection totals), prints it to logs (→ Loki), and pushes to ntfy if
the secret exists. Same content as `GET /api/brief`, the **Brief** web page,
and the `lorcana_brief` MCP tool.

Note the schedule is UTC cron, so the local delivery time shifts one hour
across DST changes. Both CronJobs use `concurrencyPolicy: Forbid`.

### 6.4 Runbook: new set release

1. `kubectl -n lorcana delete job lorcana-seed --ignore-not-found && kubectl apply -f deploy/jobs/seed-job.yaml` — pulls the new set + cards.
2. Check whether the new set should be Core-legal; if the rotation window
   changed, update `db/migrations/009_core_legal_sets.sql` and run `apply.sh`
   (see §7.3).
3. If Dreamborn labels the new set unusually and imports report
   `unknown set '...'`, add an alias (§7.4).
4. Prices for the new cards appear after the next Monday price refresh (or run
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

**Backup / restore:**

```bash
kubectl -n odin-prime exec deploy/postgresql -- \
  pg_dump -U lorcana -d lorcana --no-owner | gzip > lorcana-$(date +%F).sql.gz

gunzip -c lorcana-YYYY-MM-DD.sql.gz | \
  kubectl -n odin-prime exec -i deploy/postgresql -- psql -U lorcana -d lorcana
```

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
| `imports` | Audit of every upload incl. dry runs: sha256, mode, matched/unmatched rows (jsonb), summary. |
| `decks` / `deck_cards` | `decks.name` unique; `in_use` (mig 008) drives copy allocation; `format` ∈ constructed/sealed (mig 011); `wanted` want-list flag (mig 013); provenance `created_source`/`updated_source` ∈ api/webui/mcp (mig 004). `deck_cards.qty > 0`; the 4-copy rule is a UI/export warning, not a DB constraint. |
| `deck_pool` | Sealed decks only (mig 011): the cards opened from packs, grows weekly in a league. Sealed decks validate/build against their pool, never the collection, and are excluded from `in_use` allocation. |
| `events` | One tournament night: date, venue (`venue_id` FK preferred; `store` text fallback), deck + version, rounds/players/entry, post-event fields (`final_record`, `packs_won`, `promo`, `biggest_problem`, `one_change`). |
| `matches` / `games` | Per round: opponent, result CHECK ('2-0','2-1','1-2','0-2','DRAW','BYE'), opp inks + shape; per game: play/draw, won, `loss_mode` ('race','board','flood','screw','time','na'). Unique `(event_id, round)`. |
| `observations` | Attached to a match **xor** an event (CHECK). Kinds: `threat_card`, `tag`, `my_dead_card`, `my_mvp`, `never_drew`, `always_dead`. Feeds the cut list and brief. |
| `venues` | Stable `slug` (never delete — set `active=false`), display_name, coords (nearest-first sort from home), `event_night`/`event_time` (drives the brief's "tonight"). Seeded with 12 Bay Area stores (mig 006). |
| `price_history` | Append-only weekly snapshots per card (mig 007). Feeds price movers. |
| `news_items` | Official news scraped daily from disneylorcana.com (mig 010). `url` unique; `first_seen_at` drives the brief's NEW flag. |

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
| Web UI up but every page errors | `curl http://192.168.1.154:30710/api/health` — if not `{"status":"ok"}`, the API can't reach Postgres. `kubectl -n lorcana logs deploy/lorcana-api`; check odin-prime Postgres is up. |
| 502 from `/api/` | API pod down/not-ready (nginx is designed to 502 rather than crash). `kubectl -n lorcana get pods`, check readiness probe (it needs a working DB). |
| Upload rejected 413 | File over 10 MiB (nginx and API both cap). Split the export. |
| Upload 409 "already merged" | Duplicate-file guard on **merge** mode (same sha256 as a previous non-dry-run import). Use the "Merge anyway" button (force) or Replace mode, which is idempotent and never blocked. |
| Rows unmatched: `unknown set '…'` | Add a set alias (§7.4). |
| Rows unmatched: `ambiguous name` | The set-scoped name fallback found duplicates; fix the row's card number in the CSV (matching never guesses). |
| Migrate job failed on apply.sh | Script prints the last 50 psql lines. Fix the SQL (must be idempotent), re-run `apply.sh`. |
| New set missing from UI | Seed job hasn't run — §3.4. |
| New cards have no prices | Price refresh only updates cards it already knows and runs Mondays; run it manually (§2) after seeding. |
| Brief has no price movers | Needs ≥2 weekly `price_history` snapshots per card, and only shows owned-card moves ≥ $0.50. |
| No ntfy push | Secret `lorcana-ntfy` missing (job logs say "log-only"), or phone unsubscribed after a rotation. `kubectl -n lorcana logs job/<latest brief job>`. |
| Brief "tonight" always empty | Venues need `event_night`/`event_time` set — `PUT /api/venues/{slug}` or via psql. |
| Deck says not buildable but I own the cards | Copies are allocated to *other* built decks. Check the card detail page ("N allocated to built decks · M free"), or un-mark the other deck. Force-building is available but means physically sharing copies. |
| MCP tools failing | odin-mcp is a separate deployment: `kubectl -n odin-mcp get pods`, and it reaches this app via `:30710` like everyone else. |

Logs land in Loki with `ai.odin.loki.app_category: lorcana`.

---

## 9. Web UI user guide

Base URL `http://192.168.1.154:30710`. Nav bar: **Cards · Stats · Decks ·
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

### 9.3 Stats (`/stats`)

Collection totals (unique owned / catalog size, normal + foil copies, estimated
value), a **collection value over time** chart (today's collection at each
weekly price snapshot, hover any point for the value), **price movers** tables
(owned-card gainers/losers with a 30/90-day toggle), plus a panel per set with
completion % bar, playset progress (4+ copies), copy count, and set value.
Card detail pages get weekly price sparklines (normal + foil) once a card has
two snapshots. Deck composition counts dual-ink cards as their own "A/B"
bucket so ink counts always sum to the deck total.

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

### 9.5 Decks (`/decks`, `/decks/{id}`)

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
  per card, biggest ticket first, with a copy-as-text button for the shop.
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
  (Dreamborn-compatible, re-importable).

### 9.6 Match Log (`/matches`, `/matches/{id}`)

Tournament tracking. Standing rule (5.2): **fill between rounds, review before
pairings — never at the table.**

- **Start event:** date, venue (registry dropdown, nearest-first; "Other…" for
  free text), deck + version, rounds, players, entry fee.
- **Log round (~90 seconds):** opponent, result (2-0/2-1/1-2/0-2/DRAW/BYE),
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
whole system to Claude at `http://192.168.1.154:30720/mcp`. Deck-building
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
| `lorcana_deck_wanted` / `lorcana_want_list` | Flag decks to build; get the aggregated, priced shopping list. |
| `lorcana_sim_run` / `lorcana_sim_runs` / `lorcana_sim_result` | Queue engine simulations (vs baselines or a sim-only opponent deck), list runs, and fetch results incl. the teacher pass (turning points of a typical loss) — coaching raw material. |
| `lorcana_export_deck` | Dreamborn text + composition + Core legality (points to the printable web sheet). |
| `lorcana_deck_in_use` | Mark built/not-built; 409 shortfall flow with `force` after user confirmation. |
| `lorcana_delete_deck` | Permanent delete (confirm with the user first). |
| `lorcana_venues` | Venue registry with slugs, nights, times. |
| `lorcana_log_event` | Start an event (fuzzy venue + deck-name resolution → returns event id). |
| `lorcana_log_match` | Log a round from shorthand — games parse from text like `"G1 play W; G2 draw L race"`; inks, shape, tags, threats, dead/MVP cards. |
| `lorcana_events` / `lorcana_event` | Recent events / full pre-pairings review of one event. |
| `lorcana_match_stats` | Local meta: ink-pair frequencies, losses, known opponents (filter by store / last N events). |
| `lorcana_cut_list` | Evidence-based cuts: never-MVP cards ranked by dead mentions, plus proven MVPs. |
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
| `POST /imports` | Multipart upload: `file, mode=replace\|merge, dry_run, force`. 413 >10 MiB, 409 duplicate merge, 422 bad format. |
| `GET /imports`, `GET /imports/{id}` | Import history / full report incl. unmatched rows. |
| `GET /stats`, `GET /stats/sets` | Collection totals / per-set stats. |
| `GET /stats/value-history` | Collection value at each weekly price snapshot. |
| `GET /stats/movers?days=&limit=` | Top owned-card price gainers/losers over the window. |
| `GET /missing?set=` | Unowned cards in a set. |
| `GET /brief` | Structured brief + rendered `text`. |
| `GET/POST /decks`, `GET/PUT/DELETE /decks/{id}` | Deck CRUD (name unique; PUT replaces the whole card list). |
| `POST /decks/import` | Text list import: `overwrite`, `strict` (422 with warnings), idempotent (`unchanged`). |
| `GET /decks/{id}/buildable` | Free-copy check with per-card shortfalls (sealed decks: pool check instead). |
| `POST /decks/{id}/pool/import` | Add/replace a sealed deck's pool from a text list. |
| `DELETE /decks/{id}/pool/{card_id}` | Remove a card from a sealed pool. |
| `GET /decks/{id}/export` | Text list + composition + Core legality. |
| `PUT /decks/{id}/in_use` | Toggle allocation; 409 lists donor decks + `after_pull_missing`; `pull_from_decks=true` un-builds donors, `force=true` overrides. |
| `POST /decks/{id}/clone` | Duplicate as a new unbuilt version. |
| `GET /allocation-conflicts` | Cards claimed by built decks beyond owned copies. |
| `GET/POST /events`, `GET/PUT/DELETE /events/{id}` | Event CRUD; PUT is the post-event partial update (replaces event-level observations when given). |
| `POST /events/{id}/matches` | Log a round (unique per round; `overwrite` replaces). |
| `DELETE /matches/{id}` | Delete a round. |
| `GET/POST /venues`, `PUT /venues/{slug}` | Venue registry (nearest-first; retire with `active=false`). |
| `GET /matchlog/ink-pairs` | Meta stats (`store`, `last_events`). |
| `GET /matchlog/cut-list?deck_id=` | Never-MVP / dead-mention analysis. |
| `GET /matchlog/stats?deck_id=` | Win-rate analytics (overall, play/draw, game no., loss modes, shapes, per deck). |
| `PUT /decks/{id}/wanted` | Flag/unflag a deck for the want list. |
| `GET /wantlist` | Aggregated, priced shopping list across wanted decks (+ `text` export). |
