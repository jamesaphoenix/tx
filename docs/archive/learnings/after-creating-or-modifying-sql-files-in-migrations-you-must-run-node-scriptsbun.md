---
created: "2026-03-29T18:37:18.934Z"
---

# After creating or modifying SQL files in migrations/, you MUST run 'node scripts/bundle-migrations.js' to regenerate packages/core/src/migrations-embedded.ts. This is not automatic. The bundle script reads all .sql files sorted by numeric prefix and generates an inline TypeScript array. Verify with grep for the new version numbers in the output file.


