---
name: "docs-diagrams"
description: "Add or refine diagrams in documentation, especially Mermaid workflow diagrams in apps/docs. Use when a docs page explains actor handoffs, phase gates, failure paths, state transitions, or multi-step flows that are clearer as a diagram."
metadata:
  short-description: "Create or refine docs diagrams"
---

# Docs Diagrams

Use this skill when updating `apps/docs/content/docs/**/*.mdx` and the page would benefit from a visual explanation.

## Default Approach

1. Keep it simple. Prefer 1-2 diagrams with short titles and one-sentence captions.
2. Use the local Mermaid wrapper at `apps/docs/components/mermaid.tsx` rather than raw Mermaid fences.
3. For actor workflows, use `actorIcons={{ Human: "human", Agent: "robot" }}` when those roles are present.
4. Keep diagram labels short. Put detail in the prose below the diagram.
5. Validate with `bun run --cwd apps/docs build`.

## In This Repo

- Mermaid wrapper: `apps/docs/components/mermaid.tsx`
- Good sequence-diagram example: `apps/docs/content/docs/primitives/gate.mdx`
- Supporting docs that cross-link into the pattern: `apps/docs/content/docs/getting-started.mdx` and `apps/docs/content/docs/agent-sdk.mdx`

## Pick The Right Diagram

Use a sequence diagram for:
- agent and human handoffs
- approval gates
- failure and recovery flows
- API or service interactions

Use a flow or state diagram only when the page is really about:
- status transitions
- branching decisions
- sync/import/export direction

Do not add a diagram if a short table or 3-step list is clearer.

## Authoring Rules

- KISS. No decorative diagrams.
- Titles should be 2-4 words.
- Captions should be one sentence.
- Split diagrams that exceed roughly 8-10 messages.
- Prefer role names like `tx`, `API`, `MCP`, `Agent`, and `Human`.
- If `Human` and `Agent` both appear, make them visually distinct with `actorIcons`.
- Keep the diagram and surrounding prose semantically aligned.

## Example

```mdx
import { Mermaid } from '@/components/mermaid'

<Mermaid
  title="Happy Path"
  caption="Agent finishes the phase. Human approves the gate."
  actorIcons={{ Human: "human", Agent: "robot" }}
  chart={`sequenceDiagram
    autonumber
    participant TX as tx
    actor Agent
    actor Human

    Agent->>TX: complete phase task
    Human->>TX: approve gate
    Human->>TX: complete review task
  `}
/>
```

## Validation

```bash
bun run --cwd apps/docs build
```

If you changed Mermaid rendering logic, also spot-check the page in the browser.
