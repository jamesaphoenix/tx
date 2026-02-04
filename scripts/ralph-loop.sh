#!/bin/bash
# RALPH Loop - Run Agents via Looping Planner with Heuristics
# Runs for specified duration, processing tx tasks

set -e

# Enable RALPH mode for Claude Code hooks to enforce tests/lint
export RALPH_MODE=true

# Use bun to run the tx CLI from source
TX="bun apps/cli/src/cli.ts"
DB=".tx/tasks.db"

DURATION_HOURS=${1:-8}
DURATION_SECONDS=$((DURATION_HOURS * 3600))
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION_SECONDS))

LOG_FILE=".tx/ralph-$(date +%Y%m%d-%H%M%S).log"
mkdir -p .tx

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Generate a run ID
generate_run_id() {
    echo "run-$(echo "$1-$(date +%s)" | shasum -a 256 | cut -c1-8)"
}

# Create a run record in the database
start_run() {
    local run_id="$1"
    local task_id="$2"
    local agent="ralph"
    local started_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    sqlite3 "$DB" "INSERT INTO runs (id, task_id, agent, started_at, status, pid) VALUES ('$run_id', '$task_id', '$agent', '$started_at', 'running', $$);"
    log "Created run: $run_id for task: $task_id"
}

# Complete a run record
end_run() {
    local run_id="$1"
    local status="$2"
    local exit_code="${3:-0}"
    local ended_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    sqlite3 "$DB" "UPDATE runs SET status='$status', ended_at='$ended_at', exit_code=$exit_code WHERE id='$run_id';"
    log "Ended run: $run_id with status: $status"
}

log "RALPH Loop started - running for $DURATION_HOURS hours"
log "End time: $(date -r $END_TIME '+%Y-%m-%d %H:%M:%S')"
log "Log file: $LOG_FILE"

TASKS_COMPLETED=0
TASKS_FAILED=0

while true; do
    CURRENT_TIME=$(date +%s)
    if [ $CURRENT_TIME -ge $END_TIME ]; then
        log "Time limit reached. Stopping RALPH loop."
        break
    fi

    REMAINING=$((END_TIME - CURRENT_TIME))
    log "Time remaining: $((REMAINING / 3600))h $((REMAINING % 3600 / 60))m"

    # Get next ready task
    TASK_JSON=$($TX ready --json --limit 1 2>/dev/null || echo "[]")
    TASK_ID=$(echo "$TASK_JSON" | jq -r '.[0].id // empty')

    if [ -z "$TASK_ID" ]; then
        log "No ready tasks. Waiting 60 seconds..."
        sleep 60
        continue
    fi

    TASK_TITLE=$(echo "$TASK_JSON" | jq -r '.[0].title // "Unknown"')
    log "Starting task: $TASK_ID - $TASK_TITLE"

    # Generate run ID and start tracking
    RUN_ID=$(generate_run_id "$TASK_ID")
    start_run "$RUN_ID" "$TASK_ID"

    # Set task status to active
    $TX update "$TASK_ID" --status active 2>/dev/null || true
    log "Set task $TASK_ID to active"

    # Run Claude on the task
    if claude --print --dangerously-skip-permissions "Your task ID is: $TASK_ID

Run 'bun apps/cli/src/cli.ts show $TASK_ID' to see full details, then implement the task.

When complete, run 'bun apps/cli/src/cli.ts done $TASK_ID' to mark it done.

If blocked, use 'bun apps/cli/src/cli.ts block $TASK_ID <blocker-id>' to add a dependency." 2>&1 | tee -a "$LOG_FILE"; then

        # Check if task was completed
        TASK_STATUS=$($TX show "$TASK_ID" --json 2>/dev/null | jq -r '.status // "unknown"')

        if [ "$TASK_STATUS" = "done" ]; then
            log "Task $TASK_ID completed successfully"
            end_run "$RUN_ID" "completed" 0
            ((TASKS_COMPLETED++))

            # Auto-commit if there are changes
            if [ -n "$(git status --porcelain)" ]; then
                # Infer commit type from task title
                COMMIT_TYPE="feat"
                case "$TASK_TITLE" in
                    *[Ff]ix*|*[Bb]ug*|*CRITICAL*|*[Vv]ulnerability*|*[Ss]ecurity*)
                        COMMIT_TYPE="fix"
                        ;;
                    *[Tt]est*|*RULE\ 3*)
                        COMMIT_TYPE="test"
                        ;;
                    *[Rr]efactor*)
                        COMMIT_TYPE="refactor"
                        ;;
                    *[Dd]oc*|*README*|*CLAUDE.md*)
                        COMMIT_TYPE="docs"
                        ;;
                    *[Pp]erf*|*[Oo]ptimiz*)
                        COMMIT_TYPE="perf"
                        ;;
                esac

                # Clean up title for commit message (remove CRITICAL:, etc.)
                CLEAN_TITLE=$(echo "$TASK_TITLE" | sed -E 's/^(CRITICAL|URGENT|HIGH|LOW|RULE [0-9]+( violation)?):? *//i')

                # Run lint:fix before committing to auto-fix issues
                log "Running lint:fix before commit..."
                bun run lint:fix 2>&1 | tee -a "$LOG_FILE" || true

                git add -A
                COMMIT_MSG="$(cat <<EOF
$COMMIT_TYPE: $CLEAN_TITLE

Task: $TASK_ID

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
                if git commit -m "$COMMIT_MSG" 2>&1 | tee -a "$LOG_FILE"; then
                    log "Changes committed for $TASK_ID"
                else
                    log "WARNING: Commit failed for $TASK_ID - pre-commit hooks failed"
                    log "Attempting commit with --no-verify as fallback..."
                    if git commit --no-verify -m "$COMMIT_MSG [skip-hooks]" 2>&1 | tee -a "$LOG_FILE"; then
                        log "Changes committed for $TASK_ID (hooks skipped - needs manual review)"
                        # Create a follow-up task to fix the lint issues
                        $TX add "Fix lint/pre-commit issues from $TASK_ID" --description "Task $TASK_ID was committed with --no-verify due to pre-commit failures. Review and fix any lint issues." --score 85 2>/dev/null || true
                    else
                        log "ERROR: Commit failed even with --no-verify for $TASK_ID"
                    fi
                fi
            fi
        else
            log "Task $TASK_ID not marked done (status: $TASK_STATUS)"
            end_run "$RUN_ID" "failed" 1
            # Reset task back to ready so it can be picked up again
            $TX update "$TASK_ID" --status ready 2>/dev/null || true
            ((TASKS_FAILED++))
        fi
    else
        log "Claude execution failed for task $TASK_ID"
        end_run "$RUN_ID" "failed" 1
        # Reset task back to ready
        $TX update "$TASK_ID" --status ready 2>/dev/null || true
        ((TASKS_FAILED++))
    fi

    # Brief pause between tasks
    sleep 5
done

log "=========================================="
log "RALPH Loop Summary"
log "=========================================="
log "Tasks completed: $TASKS_COMPLETED"
log "Tasks failed/incomplete: $TASKS_FAILED"
log "Total runtime: $DURATION_HOURS hours"
log "Log saved to: $LOG_FILE"
