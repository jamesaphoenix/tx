#!/bin/bash
# Context-efficient backpressure for coding agents
# Based on HumanLayer pattern: https://humanlayer.dev/blog/context-efficient-backpressure
#
# Usage: ./run-silent.sh "description" "command"
#
# On success: prints "✓ description" (saves context)
# On failure: prints "✗ description" + FULL output (all errors, not truncated)

set -o pipefail

run_silent() {
    local description="$1"
    local command="$2"
    local tmp_file=$(mktemp)
    local start_time=$(date +%s)

    # Run command, capture all output
    if eval "$command" > "$tmp_file" 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        printf "  ✓ %s (%ds)\n" "$description" "$duration"
        rm -f "$tmp_file"
        return 0
    else
        local exit_code=$?
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        printf "  ✗ %s (%ds)\n" "$description" "$duration"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        # Show FULL output - all errors, not truncated
        cat "$tmp_file"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        rm -f "$tmp_file"
        return $exit_code
    fi
}

# If called directly with arguments
if [ $# -ge 2 ]; then
    run_silent "$1" "$2"
    exit $?
fi

# Export for sourcing
export -f run_silent
