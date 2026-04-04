---
tags: [learning]
created: "2026-03-29T19:32:40.693Z"
file_pattern: packages/core/src/services/supervision-service.ts
source_type: manual
---

# markDetached only clears the activecontroller when fe9662

markDetached only clears the active_controller when the disconnecting viewer IS the current controller. If a non-controller viewer detaches, controller field is unchanged. Tests must account for this — don't expect controller to be null after detaching a non-controller observer.
