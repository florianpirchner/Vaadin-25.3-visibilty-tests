#!/usr/bin/env bash
# Builds the same app against several Vaadin versions and runs the Playwright suite against each.
# Usage: ./run-matrix.sh [version ...]   (default: 25.2.3 25.3.0 25.3.1)
# Needs JDK 25 (JAVA_HOME), Maven, Node >= 20.
set -euo pipefail
cd "$(dirname "$0")"

VERSIONS=("$@")
[ ${#VERSIONS[@]} -eq 0 ] && VERSIONS=(25.2.3 25.3.0 25.3.1)
PORT=${PORT:-8080}
RESULTS="$PWD/results.tsv"
: > "$RESULTS"
mkdir -p dist

(cd e2e && [ -d node_modules ] || npm install --no-audit --no-fund)

status=0
for v in "${VERSIONS[@]}"; do
  echo "=== Vaadin $v: build"
  mvn -q -B -Pproduction -DskipTests -Dvaadin.version="$v" clean package
  cp target/app.jar "dist/app-$v.jar"

  echo "=== Vaadin $v: start"
  PORT=$PORT java -jar "dist/app-$v.jar" > "dist/app-$v.log" 2>&1 &
  pid=$!
  trap 'kill $pid 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "http://localhost:$PORT/" && break
    sleep 1
  done

  echo "=== Vaadin $v: test"
  (cd e2e && VAADIN_VERSION="$v" RESULTS_FILE="$RESULTS" BASE_URL="http://localhost:$PORT" npx playwright test) || status=1

  kill $pid; wait $pid 2>/dev/null || true
done

echo
echo "=== Summary (version  case  steps)"
sort "$RESULTS"
exit $status
