#!/bin/bash
# Context-efficient checks for tx
# Swallows output on success, shows FULL errors on failure
#
# Usage: ./scripts/check.sh [--all|--quick|--test|--lint|--build|--types]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Colors (only if terminal supports it)
if [ -t 1 ]; then
    GREEN='\033[0;32m'
    RED='\033[0;31m'
    YELLOW='\033[0;33m'
    NC='\033[0m' # No Color
else
    GREEN=''
    RED=''
    YELLOW=''
    NC=''
fi

run_silent() {
    local description="$1"
    local command="$2"
    local tmp_file=$(mktemp)
    local start_time=$(date +%s)

    if eval "$command" > "$tmp_file" 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        printf "${GREEN}  ✓${NC} %s ${YELLOW}(%ds)${NC}\n" "$description" "$duration"
        rm -f "$tmp_file"
        return 0
    else
        local exit_code=$?
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        printf "${RED}  ✗${NC} %s ${YELLOW}(%ds)${NC}\n" "$description" "$duration"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "FULL OUTPUT (all errors):"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        cat "$tmp_file"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        rm -f "$tmp_file"
        return $exit_code
    fi
}

# Parse test output to show summary even on success
run_tests() {
    local description="$1"
    local command="$2"
    local tmp_file=$(mktemp)
    local start_time=$(date +%s)

    if eval "$command" > "$tmp_file" 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))

        # Extract test count from vitest output
        local test_count=$(grep -oE '[0-9]+ passed' "$tmp_file" | head -1 || echo "")
        local file_count=$(grep -oE '[0-9]+ passed \([0-9]+\)' "$tmp_file" | grep -oE '\([0-9]+\)' | tr -d '()' || echo "")

        if [ -n "$test_count" ]; then
            printf "${GREEN}  ✓${NC} %s — %s ${YELLOW}(%ds)${NC}\n" "$description" "$test_count" "$duration"
        else
            printf "${GREEN}  ✓${NC} %s ${YELLOW}(%ds)${NC}\n" "$description" "$duration"
        fi
        rm -f "$tmp_file"
        return 0
    else
        local exit_code=$?
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        printf "${RED}  ✗${NC} %s ${YELLOW}(%ds)${NC}\n" "$description" "$duration"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "FULL TEST OUTPUT (all failures):"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        cat "$tmp_file"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        rm -f "$tmp_file"
        return $exit_code
    fi
}

check_types() {
    run_silent "TypeScript types (packages)" "npx turbo typecheck"
    run_silent "TypeScript types (root)" "npx tsc --noEmit"
}

check_lint() {
    run_silent "ESLint (packages)" "npx turbo lint"
    run_silent "ESLint (root)" "npx eslint src/ --max-warnings 0"
}

check_build() {
    run_silent "Build (packages)" "npx turbo build"
    run_silent "Build (root)" "npx tsc"
}

check_test() {
    run_tests "Unit & Integration tests (packages)" "npx turbo test"
    run_tests "Unit & Integration tests (root)" "npx vitest --run"
}

check_test_quick() {
    run_tests "Quick tests (no slow)" "npx vitest --run --testPathIgnorePatterns='slow|stress'"
}

check_all() {
    echo "tx checks"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    local failed=0

    check_types || failed=1
    check_lint || failed=1
    check_build || failed=1
    check_test || failed=1

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [ $failed -eq 0 ]; then
        printf "${GREEN}All checks passed${NC}\n"
        return 0
    else
        printf "${RED}Some checks failed${NC}\n"
        return 1
    fi
}

check_quick() {
    echo "tx quick checks"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    local failed=0

    check_types || failed=1
    check_lint || failed=1
    check_test_quick || failed=1

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [ $failed -eq 0 ]; then
        printf "${GREEN}Quick checks passed${NC}\n"
        return 0
    else
        printf "${RED}Some checks failed${NC}\n"
        return 1
    fi
}

# Main
case "${1:-all}" in
    --all|-a|all)
        check_all
        ;;
    --quick|-q|quick)
        check_quick
        ;;
    --test|-t|test)
        check_test
        ;;
    --lint|-l|lint)
        check_lint
        ;;
    --build|-b|build)
        check_build
        ;;
    --types|types)
        check_types
        ;;
    --help|-h|help)
        echo "Usage: $0 [--all|--quick|--test|--lint|--build|--types]"
        echo ""
        echo "Context-efficient checks - swallows output on success, shows ALL errors on failure"
        echo ""
        echo "Options:"
        echo "  --all, -a     Run all checks (types, lint, build, test)"
        echo "  --quick, -q   Run quick checks (types, lint, quick tests)"
        echo "  --test, -t    Run tests only"
        echo "  --lint, -l    Run lint only"
        echo "  --build, -b   Run build only"
        echo "  --types       Run type check only"
        ;;
    *)
        echo "Unknown option: $1"
        echo "Run '$0 --help' for usage"
        exit 1
        ;;
esac
