---
tags: [learning]
created: "2026-03-29T18:55:48.415Z"
file_pattern: "packages/core/src/services/*.ts"
source_type: manual
---

# When creating new services in packagescoresrcservices a745ed

When creating new services in packages/core/src/services/, you must also export them from packages/core/src/index.ts. Existing services (stream-service, task-service, validation-service, etc.) are re-exported via the barrel file. DomainEventService was missed during initial creation — not added to the index.
