---
tags: [learning]
created: "2026-03-29T20:41:14.807Z"
file_pattern: test/integration/ralph-context-bundle-e2e.test.ts
source_type: manual
---

# ralphcontextbundlee2etestts has 3 preexisting test failures 8e5c12

ralph-context-bundle-e2e.test.ts has 3 pre-existing test failures caused by RALPH_LOOP_PID environment variable bleeding from ralph-script tests. Error: 'Nested RALPH invocation detected (parent loop PID N)'. These are not caused by supervision changes.
