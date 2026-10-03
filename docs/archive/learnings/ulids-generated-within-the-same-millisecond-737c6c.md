---
tags: [learning]
created: "2026-03-29T19:45:51.289Z"
file_pattern: test/integration/domain-event-service.test.ts
source_type: manual
---

# ULIDs generated within the same millisecond 737c6c

ULIDs generated within the same millisecond do NOT guarantee lexicographic (strict) ordering because the random suffix can vary. Tests must assert non-decreasing timestamp prefix + uniqueness, NOT strict id1 < id2 monotonicity. The original test 'events have monotonically increasing ULIDs' failed for this reason and was fixed to check timestamp prefix ordering instead.
