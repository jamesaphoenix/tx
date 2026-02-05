#!/bin/bash
# Profile test suite memory usage
# Runs each test suite in isolation via /usr/bin/time -l to measure peak RSS
#
# Usage:
#   ./scripts/profile-test-memory.sh              # All suites (except stress/real-embedding)
#   ./scripts/profile-test-memory.sh --packages   # Package suites only (~2 min)
#   ./scripts/profile-test-memory.sh --root       # Root test groups only
#   ./scripts/profile-test-memory.sh --individual # High-interest files only
#   ./scripts/profile-test-memory.sh --stress     # Include stress tests
#   ./scripts/profile-test-memory.sh --embedding  # Include real embedding model tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Colors
if [ -t 1 ]; then
    GREEN='\033[0;32m'
    RED='\033[0;31m'
    YELLOW='\033[0;33m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    GREEN='' RED='' YELLOW='' CYAN='' BOLD='' NC=''
fi

# Options
RUN_PACKAGES=false
RUN_ROOT=false
RUN_INDIVIDUAL=false
INCLUDE_STRESS=false
INCLUDE_EMBEDDING=false
TIMEOUT=120  # Default per-suite timeout in seconds

for arg in "$@"; do
    case "$arg" in
        --packages)   RUN_PACKAGES=true ;;
        --root)       RUN_ROOT=true ;;
        --individual) RUN_INDIVIDUAL=true ;;
        --stress)     INCLUDE_STRESS=true ;;
        --embedding)  INCLUDE_EMBEDDING=true ;;
        --timeout=*)  TIMEOUT="${arg#*=}" ;;
        --help|-h)
            echo "Usage: $0 [--packages] [--root] [--individual] [--stress] [--embedding] [--timeout=SECS]"
            echo ""
            echo "  --packages      Profile package-level test suites only (fastest)"
            echo "  --root          Profile root test domain groups only"
            echo "  --individual    Profile high-interest individual files only"
            echo "  --stress        Include stress tests (STRESS=1)"
            echo "  --embedding     Include real embedding model tests"
            echo "  --timeout=SECS  Per-suite timeout in seconds (default: 120)"
            echo ""
            echo "  No flags = run all three stages"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg (try --help)"
            exit 1
            ;;
    esac
done

# Default: run all stages if none specified
if ! $RUN_PACKAGES && ! $RUN_ROOT && ! $RUN_INDIVIDUAL; then
    RUN_PACKAGES=true
    RUN_ROOT=true
    RUN_INDIVIDUAL=true
fi

# Verify /usr/bin/time exists (NOT the shell builtin)
if [ ! -x /usr/bin/time ]; then
    echo "ERROR: /usr/bin/time not found. This script requires macOS /usr/bin/time -l for peak RSS."
    exit 1
fi

# Results storage
RESULTS_FILE=$(mktemp)
trap "rm -f $RESULTS_FILE" EXIT

# ─────────────────────────────────────────────────────────────
# Core profiling function
# ─────────────────────────────────────────────────────────────

profile_command() {
    local name="$1"
    local command="$2"
    local workdir="${3:-$PROJECT_DIR}"
    local tmp=$(mktemp)

    local suite_timeout="${4:-$TIMEOUT}"

    printf "  ${CYAN}▸${NC} %-45s " "$name"

    # Run command wrapped in /usr/bin/time -l with timeout
    local exit_code=0
    local timed_out=false
    (cd "$workdir" && /usr/bin/time -l timeout "$suite_timeout" bash -c "$command" > /dev/null 2> "$tmp") 2>&1 || exit_code=$?

    # timeout exits 124 on macOS coreutils, but macOS built-in may not have timeout
    # Fall back: if exit_code=124 or process was killed, mark as timeout
    if [ $exit_code -eq 124 ]; then
        timed_out=true
    fi

    # Parse peak RSS (bytes on macOS)
    local rss_bytes
    rss_bytes=$(grep "maximum resident set size" "$tmp" 2>/dev/null | awk '{print $1}' || echo "0")
    if [ -z "$rss_bytes" ] || [ "$rss_bytes" = "0" ]; then
        # Fallback: check if time output is in the file differently
        rss_bytes=$(grep -i "maxresident" "$tmp" 2>/dev/null | awk '{print $1}' || echo "0")
    fi

    # Parse wall time
    local wall_time
    wall_time=$(grep "real" "$tmp" 2>/dev/null | head -1 | awk '{print $1}' || echo "0")
    if [ -z "$wall_time" ]; then wall_time="0"; fi

    # Convert bytes to MB
    local rss_mb="0"
    if [ -n "$rss_bytes" ] && [ "$rss_bytes" != "0" ]; then
        rss_mb=$(echo "scale=1; $rss_bytes / 1048576" | bc 2>/dev/null || echo "0")
    fi

    # Status
    local status="PASS"
    local status_color="$GREEN"
    if $timed_out; then
        status="TIMEOUT"
        status_color="$YELLOW"
    elif [ $exit_code -ne 0 ]; then
        status="FAIL"
        status_color="$RED"
    fi

    printf "${BOLD}%8s MB${NC}  %7ss  ${status_color}%s${NC}\n" "$rss_mb" "$wall_time" "$status"

    # Record result (pipe-delimited for sorting)
    echo "${rss_mb}|${name}|${wall_time}|${status}" >> "$RESULTS_FILE"

    rm -f "$tmp"
}

# ─────────────────────────────────────────────────────────────
# Header
# ─────────────────────────────────────────────────────────────

echo ""
printf "${BOLD}tx Test Suite Memory Profile${NC}\n"
echo "Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Platform: $(uname -sm)"
echo "Bun: $(bun --version 2>/dev/null || echo 'not found')"
echo ""

# ─────────────────────────────────────────────────────────────
# Stage 1: Package-level tests
# ─────────────────────────────────────────────────────────────

if $RUN_PACKAGES; then
    printf "${BOLD}Stage 1: Package Tests${NC}\n"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    profile_command "pkg/dashboard" \
        "bun vitest --run 2>&1" \
        "$PROJECT_DIR/apps/dashboard"

    profile_command "pkg/api-server" \
        "bun test 2>&1" \
        "$PROJECT_DIR/apps/api-server"

    profile_command "pkg/cli" \
        "bun vitest run --passWithNoTests 2>&1" \
        "$PROJECT_DIR/apps/cli"

    profile_command "pkg/agent-sdk" \
        "bun vitest run --passWithNoTests 2>&1" \
        "$PROJECT_DIR/apps/agent-sdk"

    profile_command "pkg/mcp-server" \
        "bun vitest run --passWithNoTests 2>&1" \
        "$PROJECT_DIR/apps/mcp-server"

    profile_command "pkg/core" \
        "bun vitest run --passWithNoTests 2>&1" \
        "$PROJECT_DIR/packages/core"

    profile_command "pkg/test-utils" \
        "bun vitest run --passWithNoTests 2>&1" \
        "$PROJECT_DIR/packages/test-utils"

    echo ""
fi

# ─────────────────────────────────────────────────────────────
# Stage 2: Root test domain groups
# ─────────────────────────────────────────────────────────────

if $RUN_ROOT; then
    printf "${BOLD}Stage 2: Root Test Groups${NC}\n"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    profile_command "group/embedding-ml" \
        "bun test test/integration/embedding.test.ts test/integration/retrieval-e2e.test.ts test/integration/retriever.test.ts test/integration/reranker.test.ts test/integration/query-expansion.test.ts test/integration/scoring-components.test.ts test/integration/diversifier.test.ts 2>&1"

    profile_command "group/sync" \
        "bun test test/integration/sync.test.ts test/integration/auto-sync.test.ts 2>&1"

    profile_command "group/daemon" \
        "bun test test/integration/daemon.test.ts test/integration/daemon-cli.test.ts test/integration/daemon-service.test.ts 2>&1"

    profile_command "group/anchor" \
        "bun test test/integration/anchor.test.ts test/integration/anchor-service.test.ts test/integration/anchor-verification.test.ts test/integration/anchor-invalidation.test.ts test/integration/anchor-soft-delete-restore.test.ts test/integration/anchor-ttl-cache.test.ts 2>&1"

    profile_command "group/graph" \
        "bun test test/integration/graph-schema.test.ts test/integration/graph-expansion.test.ts test/integration/edge-repo.test.ts test/integration/edge-service.test.ts 2>&1"

    profile_command "group/worker" \
        "bun test test/integration/worker-process.test.ts test/integration/worker-repo.test.ts test/integration/worker-service.test.ts test/integration/worker-orchestration-e2e.test.ts test/integration/run.test.ts test/integration/run-worker.test.ts 2>&1"

    profile_command "group/core-task" \
        "bun test test/integration/core.test.ts test/integration/claim-repo.test.ts test/integration/claim-service.test.ts test/integration/concurrency-breaker.test.ts test/integration/attempt.test.ts test/integration/deduplication.test.ts test/integration/compaction.test.ts 2>&1"

    profile_command "group/learning" \
        "bun test test/integration/learning.test.ts test/integration/file-learning.test.ts test/integration/file-watcher.test.ts 2>&1"

    profile_command "group/mcp" \
        "bun test test/integration/mcp.test.ts test/integration/interface-parity.test.ts 2>&1"

    profile_command "group/cli-tests" \
        "bun test test/integration/cli-commands.test.ts test/integration/cli-graph.test.ts test/integration/cli-learning.test.ts test/integration/cli-test-cache.test.ts test/integration/cli-try.test.ts test/integration/hooks.test.ts 2>&1"

    profile_command "group/chaos" \
        "bun test test/chaos/ 2>&1"

    profile_command "group/golden-paths" \
        "bun test test/golden-paths/ 2>&1"

    profile_command "group/unit" \
        "bun test test/unit/ 2>&1"

    profile_command "group/eslint-plugin" \
        "bun test eslint-plugin-tx/tests/ 2>&1"

    echo ""
fi

# ─────────────────────────────────────────────────────────────
# Stage 3: Individual high-interest files
# ─────────────────────────────────────────────────────────────

if $RUN_INDIVIDUAL; then
    printf "${BOLD}Stage 3: Individual High-Interest Files${NC}\n"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    profile_command "file/daemon.test" \
        "bun test test/integration/daemon.test.ts 2>&1"

    profile_command "file/mcp.test" \
        "bun test test/integration/mcp.test.ts 2>&1"

    profile_command "file/sync.test" \
        "bun test test/integration/sync.test.ts 2>&1"

    profile_command "file/retrieval-e2e.test" \
        "bun test test/integration/retrieval-e2e.test.ts 2>&1"

    profile_command "file/embedding.test" \
        "bun test test/integration/embedding.test.ts 2>&1"

    profile_command "file/anchor-verification.test" \
        "bun test test/integration/anchor-verification.test.ts 2>&1"

    if $INCLUDE_EMBEDDING; then
        profile_command "file/embedding-real.test (MODEL)" \
            "SKIP_REAL_EMBEDDING_TESTS= bun test test/integration/embedding-real.test.ts 2>&1"
    else
        printf "  ${YELLOW}⊘${NC} %-45s %s\n" "file/embedding-real.test (MODEL)" "skipped (use --embedding)"
    fi

    if $INCLUDE_STRESS; then
        profile_command "file/stress.test (STRESS)" \
            "STRESS=1 bun test test/chaos/stress.test.ts 2>&1"
    else
        printf "  ${YELLOW}⊘${NC} %-45s %s\n" "file/stress.test (STRESS)" "skipped (use --stress)"
    fi

    echo ""
fi

# ─────────────────────────────────────────────────────────────
# Summary: sorted results
# ─────────────────────────────────────────────────────────────

printf "${BOLD}Results (sorted by Peak RSS)${NC}\n"
echo "═══════════════════════════════════════════════════════════════════════════════"
printf "  ${BOLD}%-4s  %-45s  %10s  %8s  %s${NC}\n" "Rank" "Suite" "Peak RSS" "Time" "Status"
echo "  ────  ─────────────────────────────────────────────  ──────────  ────────  ──────"

RANK=0
sort -t'|' -k1 -rn "$RESULTS_FILE" | while IFS='|' read -r rss_mb name wall_time status; do
    ((RANK++))
    status_color="$GREEN"
    [ "$status" = "FAIL" ] && status_color="$RED"
    printf "  ${BOLD}%4d${NC}  %-45s  %8s MB  %7ss  ${status_color}%s${NC}\n" "$RANK" "$name" "$rss_mb" "$wall_time" "$status"
done

echo ""

# High-memory alerts
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
HAS_ALERT=false
while IFS='|' read -r rss_mb name wall_time status; do
    # Alert if > 500 MB
    if echo "$rss_mb > 500" | bc -l 2>/dev/null | grep -q "^1"; then
        if ! $HAS_ALERT; then
            printf "${RED}${BOLD}HIGH-MEMORY ALERTS (>500MB):${NC}\n"
            HAS_ALERT=true
        fi
        printf "  ${RED}!${NC} %s: ${BOLD}%s MB${NC}\n" "$name" "$rss_mb"
    fi
done < "$RESULTS_FILE"

if ! $HAS_ALERT; then
    printf "${GREEN}No suites exceeded 500MB peak RSS.${NC}\n"
fi

# Total time
TOTAL_TIME=$(awk -F'|' '{sum += $3} END {printf "%.1f", sum}' "$RESULTS_FILE")
SUITE_COUNT=$(wc -l < "$RESULTS_FILE" | tr -d ' ')
echo ""
echo "Profiled $SUITE_COUNT suites in ${TOTAL_TIME}s total"
echo ""
