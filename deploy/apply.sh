#!/usr/bin/env bash
# Idempotent deploy for the Lorcana collection app.
# Mirrors the swrpg apply.sh conventions: secrets created only if missing,
# one-time DB bootstrap guarded, migrations re-runnable.
set -euo pipefail
cd "$(dirname "$0")"

NS=lorcana
PG_NS=odin-prime
PG_DEPLOY=postgresql

echo "== namespace"
kubectl apply -f namespace.yaml

echo "== secret lorcana-db (create only if missing)"
if ! kubectl -n "$NS" get secret lorcana-db >/dev/null 2>&1; then
  PW="${LORCANA_DB_PASSWORD:-$(openssl rand -hex 24)}"
  kubectl -n "$NS" create secret generic lorcana-db \
    --from-literal=DATABASE_URL="postgresql://lorcana:${PW}@postgresql.${PG_NS}.svc.cluster.local:5432/lorcana" \
    --from-literal=PGPASSWORD="${PW}"
  echo "   created (password generated; stored only in the k8s secret)"
else
  echo "   exists, leaving as-is"
fi
PW="$(kubectl -n "$NS" get secret lorcana-db -o jsonpath='{.data.PGPASSWORD}' | base64 -d)"

echo "== one-time DB bootstrap (role + database via odin-prime postgres pod)"
if kubectl -n "$PG_NS" exec deploy/"$PG_DEPLOY" -- \
     sh -c 'psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='"'"'lorcana'"'"'"' \
     | grep -q 1; then
  echo "   database exists, skipping"
else
  kubectl -n "$PG_NS" exec -i deploy/"$PG_DEPLOY" -- \
    sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -v LORCANA_DB_PASSWORD="'"$PW"'" -f -' \
    < ../db/migrations/000_role_db.sql
  echo "   role + database created"
fi

echo "== apply manifests"
kubectl apply -k .

echo "== migrations configmap"
CM_ARGS=""
for f in ../db/migrations/0*.sql; do
  case "$f" in *000_role_db.sql) continue ;; esac   # admin bootstrap, not app-role runnable
  CM_ARGS="$CM_ARGS --from-file=$f"
done
# shellcheck disable=SC2086
kubectl -n "$NS" create configmap lorcana-migrations $CM_ARGS \
  --dry-run=client -o yaml | kubectl apply -f -

echo "== run migrations"
kubectl -n "$NS" delete job lorcana-migrate --ignore-not-found
kubectl apply -f jobs/migrate-job.yaml
kubectl -n "$NS" wait --for=condition=complete job/lorcana-migrate --timeout=120s || {
  echo "migration job did not complete; logs:"
  kubectl -n "$NS" logs job/lorcana-migrate --tail=50
  exit 1
}

echo "== rollout"
kubectl -n "$NS" rollout status deploy/lorcana-api --timeout=180s
kubectl -n "$NS" rollout status deploy/lorcana-web --timeout=180s

cat <<EOF

Done.
  Web UI:     http://192.168.1.154:30710
  Seed cards: kubectl -n $NS delete job lorcana-seed --ignore-not-found && kubectl apply -f jobs/seed-job.yaml
EOF
