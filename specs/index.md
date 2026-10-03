# Documentation Index

**Description**: Search map for subsystem PRDs and design docs. Use this file to find the authoritative spec by feature area, domain term, or implementation concern.

**Search Keywords**: lean-task-spec-design, Task and specification runtime, lean-task-spec, design, lean, task, spec, lean-task-spec-plan, tx v0.20.0 implementation plan, plan, lean-task-spec-prd, Tasks, specs and plans, prd

## Product Requirements Documents

| Name | Title | Description | Search Keywords | Status |
|------|-------|-------------|-----------------|--------|
| [lean-task-spec-prd](prd/lean-task-spec-prd.md) | Tasks, specs and plans | Task and spec driven development with plans, safe upgrades and four portable guides. | lean-task-spec, prd, lean, task, spec | changing |

## Design Documents

| Name | Title | Description | Search Keywords | Implements | Status |
|------|-------|-------------|-----------------|------------|--------|
| [lean-task-spec-design](design/lean-task-spec-design.md) | Task and specification runtime | Shared task and spec runtime with safe historical compatibility and plan hierarchy. | lean-task-spec, design, lean, task, spec | lean-task-spec-prd | changing |

## Implementation Plans

| Name | Title | Description | Search Keywords | Status |
|------|-------|-------------|-----------------|--------|
| [lean-task-spec-plan](plan/lean-task-spec-plan.md) | tx v0.20.0 implementation plan | Implementation steps for the approved tx v0.20.0 task and spec only release. | lean-task-spec, plan, lean, task, spec | changing |

## Invariant Summary

**Total invariants**: 10

**By enforcement type**:

- integration_test: 10

**By subsystem**:

- design: 5
- prd: 5

## Document Links

| From | To | Type |
|------|-----|------|
| lean-task-spec-prd | lean-task-spec-design | prd_to_design |
| lean-task-spec-design | lean-task-spec-plan | spec_to_plan |
