---
tags: [learning]
created: "2026-03-29T19:21:34.002Z"
file_pattern: packages/core/src/services/doc-review-service.ts
source_type: manual
---

# completeRun expects passed boolean findings string ee4712

completeRun expects {passed: boolean, findings: string[]} shape. failRun expects {reason: string, retryable: boolean} shape. These are not explicit named types — they're inline object params in the service methods.
