#!/usr/bin/env bash
# Build → push → deploy one component, with session-scoped tags so two
# people (or two Claude sessions) working at once cannot silently
# overwrite each other's deploy.
#
# THE RACE THIS PREVENTS
#   Session A builds :20260807a, edits the manifest, deploys.
#   Session B builds :20260807b from ITS tree, edits the same manifest,
#   deploys — A's image is gone and A never finds out.
# Fix: every tag carries its session (never collides), and before
# deploying we check the cluster is running what the manifest says. If
# someone else deployed in between, we stop and show you what happened.
#
#   ./release.sh api                 # build+push+deploy the API
#   ./release.sh web --build-only    # build+push, leave the cluster alone
#   ./release.sh api --force         # deploy over someone else's image
#   LORCANA_SESSION=fable ./release.sh api
#
# Session id: $LORCANA_SESSION, else deploy/.session, else $USER.
set -euo pipefail
cd "$(dirname "$0")"

NS=lorcana
REGISTRY=localhost:30500

component="${1:-}"
shift || true
build_only=false
force=false
for arg in "$@"; do
  case "$arg" in
    --build-only) build_only=true ;;
    --force) force=true ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

case "$component" in
  api) repo="lorcana/api"; prefix="fastapi"; context="../api"; deployment="lorcana-api"
       primary="api/deployment.yaml"
       manifests="api/deployment.yaml jobs/daily-brief-cronjob.yaml jobs/news-fetch-cronjob.yaml jobs/price-refresh-cronjob.yaml jobs/seed-job.yaml" ;;
  web) repo="lorcana/web"; prefix="nginx"; context="../web"; deployment="lorcana-web"
       primary="web/deployment.yaml"
       manifests="web/deployment.yaml" ;;
  *) echo "usage: $0 {api|web} [--build-only] [--force]" >&2; exit 2 ;;
esac

session="${LORCANA_SESSION:-$( [ -f .session ] && cat .session || echo "${USER:-anon}" )}"
session="$(echo "$session" | tr -cd '[:alnum:]-' | cut -c1-12)"
date_part="$(date +%Y%m%d)"

# Sequence: highest existing n for this (prefix, date, session), + 1.
existing="$(curl -fsS "http://${REGISTRY}/v2/${repo}/tags/list" 2>/dev/null \
  | python3 -c "import json,sys;print('\n'.join(json.load(sys.stdin).get('tags') or []))" 2>/dev/null || true)"
seq=$(echo "$existing" \
  | sed -n "s/^${prefix}-${date_part}-${session}-\([0-9]\+\)$/\1/p" \
  | sort -n | tail -1)
seq=$(( ${seq:-0} + 1 ))
tag="${prefix}-${date_part}-${session}-${seq}"
image="${REGISTRY}/${repo}:${tag}"

# --- race guard, BEFORE building: is the cluster running what the
# manifest claims? A mismatch means someone else deployed since this
# tree was updated. Checked first so a doomed deploy doesn't burn a
# build. --build-only skips it (it never touches the cluster).
if ! $build_only; then
  manifest_image="$(grep -hoP "(?<=image: )${REGISTRY}/${repo}:\S+" "$primary" 2>/dev/null | head -1)"
  live_image="$(kubectl -n "$NS" get deploy "$deployment" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
  if [ -n "$live_image" ] && [ -n "$manifest_image" ] && [ "$live_image" != "$manifest_image" ]; then
    echo "!! RACE DETECTED — not building."
    echo "   cluster is running : $live_image"
    echo "   this tree expects  : $manifest_image"
    echo "   Someone else deployed since your tree was updated. Pull/rebase,"
    echo "   or re-run with --force to deploy over them."
    $force || exit 1
    echo "   --force given; continuing."
  fi
fi

echo "== building ${image}"
buildah bud --format docker -q -t "$image" "$context" >/dev/null
buildah push --tls-verify=false "$image" >/dev/null
echo "   pushed"

if $build_only; then
  echo "== build-only: cluster untouched. Deploy later with:"
  echo "   ./release.sh ${component}   # (rebuilds; or edit ${primary} to ${tag} and kubectl apply -k .)"
  exit 0
fi

echo "== pointing manifests at ${tag}"
for m in $manifests; do
  [ -f "$m" ] && sed -i "s|${repo}:[A-Za-z0-9._-]*|${repo}:${tag}|g" "$m"
done

kubectl apply -k . >/dev/null
kubectl -n "$NS" rollout status "deploy/${deployment}" --timeout=180s
echo "== deployed ${image}"
echo "   commit the manifest change so the tree matches the cluster."
