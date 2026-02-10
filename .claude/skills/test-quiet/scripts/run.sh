#!/bin/bash
# Context-efficient test runner for coding agents
# Inspired by HumanLayer's backpressure pattern:
#   https://humanlayer.dev/blog/context-efficient-backpressure
#
# Runs vitest, hides passing test output, shows ONLY failures with ALL errors.
# Optionally detects flaky tests by re-running failures.
#
# Usage:
#   .claude/skills/test-quiet/scripts/run.sh                        # All integration tests
#   .claude/skills/test-quiet/scripts/run.sh test/integration/core   # Specific path
#   .claude/skills/test-quiet/scripts/run.sh --flaky                 # Detect flaky (3 re-runs)
#   .claude/skills/test-quiet/scripts/run.sh --flaky --runs 5        # Detect flaky (5 re-runs)

set -o pipefail

# Resolve project root (skill lives at .claude/skills/test-quiet/scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$PROJECT_DIR"

# ── Defaults ──────────────────────────────────────────────────────────────────
FLAKY_MODE=false
FLAKY_RUNS=3
TEST_PATH="test/integration/"

# ── Colors (only if terminal) ────────────────────────────────────────────────
if [ -t 1 ]; then
    GREEN='\033[0;32m'
    RED='\033[0;31m'
    YELLOW='\033[0;33m'
    CYAN='\033[0;36m'
    DIM='\033[2m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    GREEN='' RED='' YELLOW='' CYAN='' DIM='' BOLD='' NC=''
fi

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --flaky)
            FLAKY_MODE=true
            shift
            ;;
        --runs)
            FLAKY_RUNS="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [options] [test-path]"
            echo ""
            echo "Context-efficient test runner. Hides passing output, shows ALL failures."
            echo ""
            echo "Options:"
            echo "  --flaky         Re-run failing tests to detect flakiness (default: 3 re-runs)"
            echo "  --runs N        Number of re-runs for flaky detection (default: 3)"
            echo "  --help, -h      Show this help"
            echo ""
            echo "Examples:"
            echo "  $0                                  # All integration tests"
            echo "  $0 test/integration/core.test.ts    # Single file"
            echo "  $0 test/integration/                # Directory"
            echo "  $0 --flaky                          # Find flaky tests"
            echo "  $0 --flaky --runs 5                 # 5 re-runs per failure"
            exit 0
            ;;
        *)
            TEST_PATH="$1"
            shift
            ;;
    esac
done

# ── Phase 1: Run all tests with JSON reporter ────────────────────────────────
printf "${BOLD}tx test-quiet${NC} ${DIM}— hide passing, show ALL failures${NC}\n"
printf "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"

TMP_JSON=$(mktemp)
TMP_STDERR=$(mktemp)
START_TIME=$(date +%s)

# Run vitest with JSON reporter (stdout=JSON, stderr=progress)
bunx --bun vitest run "$TEST_PATH" --reporter=json 2>"$TMP_STDERR" >"$TMP_JSON"
VITEST_EXIT=$?

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# ── Phase 2: Parse JSON results ──────────────────────────────────────────────
if ! jq empty "$TMP_JSON" 2>/dev/null; then
    printf "${RED}  ✗ vitest failed to produce valid JSON output${NC}\n"
    echo ""
    echo "━━━ stderr ━━━"
    cat "$TMP_STDERR"
    echo "━━━ stdout ━━━"
    cat "$TMP_JSON"
    rm -f "$TMP_JSON" "$TMP_STDERR"
    exit 1
fi

# Use testResults array for accurate file counts
TOTAL_FILES=$(jq '.testResults | length' "$TMP_JSON")
PASSED_FILES=$(jq '[.testResults[] | select(.status == "passed")] | length' "$TMP_JSON")
FAILED_FILES=$(jq '[.testResults[] | select(.status == "failed")] | length' "$TMP_JSON")
TOTAL_TESTS=$(jq '.numTotalTests' "$TMP_JSON")
PASSED_TESTS=$(jq '.numPassedTests' "$TMP_JSON")
FAILED_TESTS=$(jq '.numFailedTests' "$TMP_JSON")
SKIPPED_TESTS=$(jq '.numPendingTests' "$TMP_JSON")

# ── Phase 3: Display per-file results ────────────────────────────────────────
PASSING_FILES=$(jq -r '.testResults[] | select(.status == "passed") | .name' "$TMP_JSON" | sort)
FAILING_FILES=$(jq -r '.testResults[] | select(.status == "failed") | .name' "$TMP_JSON" | sort)

# Passing files: compact ✓ lines (minimal context)
while IFS= read -r file; do
    [ -z "$file" ] && continue
    test_count=$(jq -r --arg f "$file" '.testResults[] | select(.name == $f) | .assertionResults | length' "$TMP_JSON")
    short_name="${file#$PROJECT_DIR/}"
    printf "${GREEN}  ✓${NC} %s ${DIM}(%s tests)${NC}\n" "$short_name" "$test_count"
done <<< "$PASSING_FILES"

# Collect failing file paths for flaky detection
declare -a FAILED_FILE_LIST=()

# Failing files: show EVERY failure (no bail, no truncation)
while IFS= read -r file; do
    [ -z "$file" ] && continue
    short_name="${file#$PROJECT_DIR/}"
    FAILED_FILE_LIST+=("$short_name")

    file_passed=$(jq -r --arg f "$file" '[.testResults[] | select(.name == $f) | .assertionResults[] | select(.status == "passed")] | length' "$TMP_JSON")
    file_failed=$(jq -r --arg f "$file" '[.testResults[] | select(.name == $f) | .assertionResults[] | select(.status == "failed")] | length' "$TMP_JSON")

    printf "${RED}  ✗${NC} %s ${DIM}(%s passed, %s failed)${NC}\n" "$short_name" "$file_passed" "$file_failed"

    # Show each failing test name + first line of error (context-efficient)
    jq -r --arg f "$file" '
        .testResults[]
        | select(.name == $f)
        | .assertionResults[]
        | select(.status == "failed")
        | "    FAIL: " + .fullName + "\n" +
          (if (.failureMessages | length) > 0
           then "      " + (.failureMessages[0] | split("\n") | .[0])
           else "" end)
    ' "$TMP_JSON" 2>/dev/null | while IFS= read -r line; do
        [ -n "$line" ] && printf "${RED}%s${NC}\n" "$line"
    done
done <<< "$FAILING_FILES"

# ── Phase 4: Summary ─────────────────────────────────────────────────────────
printf "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"

if [ "$FAILED_FILES" -eq 0 ]; then
    printf "${GREEN}${BOLD}All passing${NC} — %s tests across %s files ${DIM}(%ds)${NC}\n" "$PASSED_TESTS" "$TOTAL_FILES" "$DURATION"
else
    printf "${RED}${BOLD}%s/%s files failed${NC} — %s/%s tests failed, %s skipped ${DIM}(%ds)${NC}\n" \
        "$FAILED_FILES" "$TOTAL_FILES" "$FAILED_TESTS" "$TOTAL_TESTS" "$SKIPPED_TESTS" "$DURATION"
fi

# ── Phase 5: Flaky detection ─────────────────────────────────────────────────
if [ "$FLAKY_MODE" = true ] && [ ${#FAILED_FILE_LIST[@]} -gt 0 ]; then
    printf "\n${BOLD}${CYAN}Flaky detection${NC} — re-running %s failing files %s times each\n" "${#FAILED_FILE_LIST[@]}" "$FLAKY_RUNS"
    printf "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"

    declare -a FLAKY_FILES=()
    declare -a CONSISTENT_FAILURES=()

    for failed_file in "${FAILED_FILE_LIST[@]}"; do
        pass_count=0
        fail_count=0

        for ((run=1; run<=FLAKY_RUNS; run++)); do
            TMP_RUN=$(mktemp)
            if bunx --bun vitest run "$failed_file" --reporter=json 2>/dev/null >"$TMP_RUN"; then
                run_ok=$(jq '.numFailedTests' "$TMP_RUN" 2>/dev/null)
                if [ "$run_ok" = "0" ]; then
                    pass_count=$((pass_count + 1))
                else
                    fail_count=$((fail_count + 1))
                fi
            else
                fail_count=$((fail_count + 1))
            fi
            rm -f "$TMP_RUN"
        done

        if [ "$pass_count" -gt 0 ] && [ "$fail_count" -gt 0 ]; then
            FLAKY_FILES+=("$failed_file")
            printf "${YELLOW}  ~ FLAKY${NC} %s ${DIM}(%s pass / %s fail in %s runs)${NC}\n" \
                "$failed_file" "$pass_count" "$fail_count" "$FLAKY_RUNS"
        elif [ "$fail_count" -eq "$FLAKY_RUNS" ]; then
            CONSISTENT_FAILURES+=("$failed_file")
            printf "${RED}  ✗ CONSISTENT${NC} %s ${DIM}(failed all %s runs)${NC}\n" \
                "$failed_file" "$FLAKY_RUNS"
        else
            FLAKY_FILES+=("$failed_file")
            printf "${YELLOW}  ~ FLAKY${NC} %s ${DIM}(passed all %s re-runs but failed initial)${NC}\n" \
                "$failed_file" "$FLAKY_RUNS"
        fi
    done

    printf "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"

    if [ ${#FLAKY_FILES[@]} -gt 0 ]; then
        printf "${YELLOW}${BOLD}Flaky tests detected: %s files${NC}\n" "${#FLAKY_FILES[@]}"
        for f in "${FLAKY_FILES[@]}"; do
            printf "  - %s\n" "$f"
        done
    fi

    if [ ${#CONSISTENT_FAILURES[@]} -gt 0 ]; then
        printf "${RED}${BOLD}Consistent failures: %s files${NC}\n" "${#CONSISTENT_FAILURES[@]}"
        for f in "${CONSISTENT_FAILURES[@]}"; do
            printf "  - %s\n" "$f"
        done
    fi

    if [ ${#FLAKY_FILES[@]} -eq 0 ]; then
        printf "${GREEN}No flaky tests detected${NC} — all failures are consistent\n"
    fi
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -f "$TMP_JSON" "$TMP_STDERR"

exit $VITEST_EXIT
