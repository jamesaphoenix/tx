---
created: "2026-03-29T18:21:50.976Z"
---

# When adding new type modules to packages/types, use bun -e with require() to verify runtime importability of all new exports after tsc build passes. Pattern: bun -e "const t = require('./packages/types/src/index.ts'); console.log('SchemaName:', \!\!t.SchemaName)" — catches export wiring issues that tsc alone may not surface.


