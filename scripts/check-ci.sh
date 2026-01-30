#!/bin/bash
# CI-optimized checks with GitHub Actions annotations
# Uses context-efficient backpressure pattern
#
# Features:
# - Groups output in GitHub Actions (collapsible)
# - Produces annotations for failures
# - Swallows verbose output on success
# - Shows ALL errors on failure (not truncated)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Detect GitHub Actions
IS_GH_ACTIONS="${GITHUB_ACTIONS:-false}"

# GitHub Actions helpers
gh_group_start() {
    if [ "$IS_GH_ACTIONS" = "true" ]; then
        echo "::group::$1"
    else
        echo "━━━ $1 ━━━"
    fi
}

gh_group_end() {
    if [ "$IS_GH_ACTIONS" = "true" ]; then
        echo "::endgroup::"
    fi
}

gh_error() {
    if [ "$IS_GH_ACTIONS" = "true" ]; then
        echo "::error::$1"
    else
        echo "ERROR: $1"
    fi
}

gh_notice() {
    if [ "$IS_GH_ACTIONS" = "true" ]; then
        echo "::notice::$1"
    else
        echo "NOTICE: $1"
    fi
}

# Run a check with context-efficient output
run_check() {
    local name="$1"
    local command="$2"
    local tmp_file=$(mktemp)
    local start_time=$(date +%s)

    gh_group_start "$name"

    if eval "$command" > "$tmp_file" 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))

        # Success: minimal output
        echo "✓ $name passed (${duration}s)"

        # For tests, extract count
        if [[ "$name" == *"test"* ]] || [[ "$name" == *"Test"* ]]; then
            local test_count=$(grep -oE '[0-9]+ passed' "$tmp_file" | head -1 || echo "")
            if [ -n "$test_count" ]; then
                echo "  $test_count"
            fi
        fi

        gh_group_end
        rm -f "$tmp_file"
        return 0
    else
        local exit_code=$?
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))

        # Failure: show FULL output
        echo "✗ $name failed (${duration}s)"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "FULL OUTPUT (all errors, not truncated):"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        cat "$tmp_file"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        gh_error "$name failed"
        gh_group_end
        rm -f "$tmp_file"
        return $exit_code
    fi
}

# Summary tracking
FAILED_CHECKS=()
PASSED_CHECKS=()

run_and_track() {
    local name="$1"
    local command="$2"

    if run_check "$name" "$command"; then
        PASSED_CHECKS+=("$name")
    else
        FAILED_CHECKS+=("$name")
    fi
}

echo "tx CI Checks"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run all checks (continue on failure to report all issues)
run_and_track "TypeScript" "npx tsc --noEmit"
run_and_track "ESLint" "npx eslint src/ --max-warnings 0"
run_and_track "Build" "npm run build"
run_and_track "Tests" "npm test"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for check in "${PASSED_CHECKS[@]}"; do
    echo "  ✓ $check"
done

for check in "${FAILED_CHECKS[@]}"; do
    echo "  ✗ $check"
done

echo ""

if [ ${#FAILED_CHECKS[@]} -eq 0 ]; then
    gh_notice "All ${#PASSED_CHECKS[@]} checks passed"
    echo "All checks passed!"
    exit 0
else
    gh_error "${#FAILED_CHECKS[@]} check(s) failed: ${FAILED_CHECKS[*]}"
    echo "${#FAILED_CHECKS[@]} check(s) failed"
    exit 1
fi
