---
created: "2026-03-29T18:22:00.375Z"
---

# Domain event type constants use dotted naming convention: 'worker.session_created', 'design_doc.review_eligible', etc. The SUPERVISION_EVENT_TYPES array combines all 19 event types (12 worker + 7 design_doc). SupervisionDomainEvent is a Schema.Union of all individual event payload schemas, each tagged by their event_type literal.


