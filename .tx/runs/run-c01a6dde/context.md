Read .codex/agents/tx-implementer.md for your instructions.

Your assigned task: tx-9b61c0e5cba2
Task title: Implement Ralph bundle
Task scope: all-tasks

You are given direct working context below. Read it before changing code:

===== BEGIN RALPH TASK SCOPE =====
all-tasks

===== END RALPH TASK SCOPE =====

===== BEGIN CURRENT TASK PAYLOAD (JSON) =====
{
  "id": "tx-9b61c0e5cba2",
  "title": "Implement Ralph bundle",
  "description": "Primary task for Ralph context bundle coverage",
  "status": "active",
  "parentId": null,
  "score": 0,
  "createdAt": "2026-08-12T13:11:58.800Z",
  "updatedAt": "2026-08-12T13:12:06.848Z",
  "completedAt": null,
  "assigneeType": null,
  "assigneeId": null,
  "assignedAt": null,
  "assignedBy": null,
  "metadata": {},
  "blockedBy": [],
  "blocks": [],
  "children": [],
  "isReady": true,
  "groupContext": null,
  "effectiveGroupContext": null,
  "effectiveGroupContextSourceTaskId": null,
  "orchestrationStatus": "running",
  "claimedBy": "ralph-main",
  "claimExpiresAt": "2026-08-12T13:42:06.473Z",
  "failedAttempts": 0,
  "linkedDocs": [
    {
      "docId": "doc-bb0f2ae91a1a",
      "name": "ralph-context-prd",
      "title": "Ralph Context PRD",
      "kind": "prd",
      "version": 1,
      "status": "changing",
      "filePath": "prd/ralph-context-prd.md",
      "linkType": "implements"
    },
    {
      "docId": "doc-fe6990bab078",
      "name": "ralph-context-design",
      "title": "Ralph Context Design",
      "kind": "design",
      "version": 1,
      "status": "changing",
      "filePath": "design/ralph-context-design.md",
      "linkType": "references"
    }
  ],
  "attempts": []
}

===== END CURRENT TASK PAYLOAD (JSON) =====

===== BEGIN LINKED DESIGN DOCS (MARKDOWN) =====
## ralph-context-design

---
kind: spec
spec_type: design
doc_id: doc-fe6990bab078
name: ralph-context-design
title: "Ralph Context Design"
status: draft
version: 1
owners:
  - docs-team
summary: "Technical design for Ralph Context Design."
domain: ralph-context
tags:
  - design
  - ralph
  - context
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-08-12
---

# Summary
Describe the design approach.

# Architecture
## Components
...

# Interfaces
```yaml
interfaces: []
```

# Data Model
No data model changes.

# Invariants
```yaml
invariants: []
```

# Failure Modes
```yaml
failure_modes: []
```

# Verification
```yaml
verification: []
```

# Testing Strategy
## Unit Tests
...

## Integration Tests
...

# Open Questions
- [ ] Unresolved design decisions

## Sandbox Marker
Design doc sentinel for Ralph bundle e2e.



===== END LINKED DESIGN DOCS (MARKDOWN) =====

===== BEGIN ALL TASKS (JSON) =====
[
  {
    "id": "tx-8df425f13fff",
    "title": "Document follow-up task",
    "description": "Sibling task that should appear in the injected queue snapshot",
    "status": "blocked",
    "parentId": null,
    "score": 0,
    "createdAt": "2026-08-12T13:11:59.422Z",
    "updatedAt": "2026-08-12T13:12:01.230Z",
    "completedAt": null,
    "assigneeType": null,
    "assigneeId": null,
    "assignedAt": null,
    "assignedBy": null,
    "metadata": {},
    "blockedBy": [],
    "blocks": [],
    "children": [],
    "isReady": false,
    "groupContext": null,
    "effectiveGroupContext": null,
    "effectiveGroupContextSourceTaskId": null,
    "orchestrationStatus": "unclaimed",
    "claimedBy": null,
    "claimExpiresAt": null,
    "failedAttempts": 0,
    "linkedDocs": [
      {
        "docId": "doc-fe6990bab078",
        "name": "ralph-context-design",
        "title": "Ralph Context Design",
        "kind": "design",
        "version": 1,
        "status": "changing",
        "filePath": "design/ralph-context-design.md",
        "linkType": "references"
      }
    ]
  },
  {
    "id": "tx-9b61c0e5cba2",
    "title": "Implement Ralph bundle",
    "description": "Primary task for Ralph context bundle coverage",
    "status": "active",
    "parentId": null,
    "score": 0,
    "createdAt": "2026-08-12T13:11:58.800Z",
    "updatedAt": "2026-08-12T13:12:06.848Z",
    "completedAt": null,
    "assigneeType": null,
    "assigneeId": null,
    "assignedAt": null,
    "assignedBy": null,
    "metadata": {},
    "blockedBy": [],
    "blocks": [],
    "children": [],
    "isReady": true,
    "groupContext": null,
    "effectiveGroupContext": null,
    "effectiveGroupContextSourceTaskId": null,
    "orchestrationStatus": "running",
    "claimedBy": "ralph-main",
    "claimExpiresAt": "2026-08-12T13:42:06.473Z",
    "failedAttempts": 0,
    "linkedDocs": [
      {
        "docId": "doc-bb0f2ae91a1a",
        "name": "ralph-context-prd",
        "title": "Ralph Context PRD",
        "kind": "prd",
        "version": 1,
        "status": "changing",
        "filePath": "prd/ralph-context-prd.md",
        "linkType": "implements"
      },
      {
        "docId": "doc-fe6990bab078",
        "name": "ralph-context-design",
        "title": "Ralph Context Design",
        "kind": "design",
        "version": 1,
        "status": "changing",
        "filePath": "design/ralph-context-design.md",
        "linkType": "references"
      }
    ]
  },
  {
    "id": "tx-e4a4635bf816",
    "title": "Unrelated queue task",
    "description": "Task outside the design-doc scope that should only appear in global queue mode",
    "status": "blocked",
    "parentId": null,
    "score": 0,
    "createdAt": "2026-08-12T13:11:59.991Z",
    "updatedAt": "2026-08-12T13:12:01.808Z",
    "completedAt": null,
    "assigneeType": null,
    "assigneeId": null,
    "assignedAt": null,
    "assignedBy": null,
    "metadata": {},
    "blockedBy": [],
    "blocks": [],
    "children": [],
    "isReady": false,
    "groupContext": null,
    "effectiveGroupContext": null,
    "effectiveGroupContextSourceTaskId": null,
    "orchestrationStatus": "unclaimed",
    "claimedBy": null,
    "claimExpiresAt": null,
    "failedAttempts": 0,
    "linkedDocs": []
  }
]

===== END ALL TASKS (JSON) =====

Follow the profile instructions first.
Helpful commands if needed:
- `tx show tx-9b61c0e5cba2` for full task details, including any linked docs/specs
- `tx memory context tx-9b61c0e5cba2` for related learnings

When complete, run `tx done tx-9b61c0e5cba2`.
If you discover new work, create follow-up tasks with `tx add` and subtasks with `tx add ... --parent tx-9b61c0e5cba2`.
If dependencies need to change, use `tx dep block` and `tx dep unblock`.
If the queue needs reordering, update scores with `tx update <id> --score <n>` or `tx bulk score <n> <id...>`.
If a non-trivial task needs specs, prefer a paired PRD/design doc: attach the PRD with `tx doc attach tx-9b61c0e5cba2 <prd-doc> --type implements` and the design doc with `tx doc attach tx-9b61c0e5cba2 <design-doc> --type references`.
If one half of the PRD/design pair is missing, create follow-up docs work or block the task before large implementation proceeds.
If blocked, run `tx update tx-9b61c0e5cba2 --status blocked`.
Optionally record useful insights:
- File-specific: `tx memory learn "<file-path>" "<gotcha or convention>"`
- Broader: `tx memory add "<title>" -c "<detail>" -t learnings -d docs/learnings`
