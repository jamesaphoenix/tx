#!/bin/bash
# RALPH Loop - Run Agents via Looping Planner with Heuristics
# Runs for specified duration, processing tx tasks

set -e

DURATION_HOURS=${1:-8}
DURATION_SECONDS=$((DURATION_HOURS * 3600))
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION_SECONDS))

LOG_FILE=".tx/ralph-$(date +%Y%m%d-%H%M%S).log"
mkdir -p .tx

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
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
    TASK_JSON=$(tx ready --json --limit 1 2>/dev/null || echo "[]")
    TASK_ID=$(echo "$TASK_JSON" | jq -r '.[0].id // empty')

    if [ -z "$TASK_ID" ]; then
        log "No ready tasks. Waiting 60 seconds..."
        sleep 60
        continue
    fi

    TASK_TITLE=$(echo "$TASK_JSON" | jq -r '.[0].title // "Unknown"')
    log "Starting task: $TASK_ID - $TASK_TITLE"

    # Run Claude on the task
    if claude --print "Read CLAUDE.md first for project context. Your task ID is: $TASK_ID

Run 'tx show $TASK_ID' to see full details, then implement the task.

When complete, run 'tx done $TASK_ID' to mark it done.

If blocked, use 'tx block $TASK_ID <blocker-id>' to add a dependency.

IMPORTANT: Commit your changes with a descriptive message when done." 2>&1 | tee -a "$LOG_FILE"; then

        # Check if task was completed
        TASK_STATUS=$(tx show "$TASK_ID" --json 2>/dev/null | jq -r '.status // "unknown"')

        if [ "$TASK_STATUS" = "done" ]; then
            log "Task $TASK_ID completed successfully"
            ((TASKS_COMPLETED++))

            # Auto-commit if there are changes
            if [ -n "$(git status --porcelain)" ]; then
                git add -A
                git commit -m "Complete $TASK_ID: $TASK_TITLE

Automated commit by RALPH loop" || true
                log "Changes committed for $TASK_ID"
            fi
        else
            log "Task $TASK_ID not marked done (status: $TASK_STATUS)"
            ((TASKS_FAILED++))
        fi
    else
        log "Claude execution failed for task $TASK_ID"
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
