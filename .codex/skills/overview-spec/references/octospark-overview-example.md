# Example: Octospark Overview Source

Source document pattern:

- `/<some-source-path>/specs/<overview-or-requirements-doc>.md`

Concrete example used for this reference:

- `/Users/jamesaphoenix/Desktop/projects/just-understanding-data/octospark/specs/requirements.md`

Why this is a strong overview example:

- It captures project-level context that spans multiple eventual PRDs and design docs.
- It keeps market framing, target audience, actor definitions, launch features, and platform strategy together.
- It demonstrates that an overview can stay rich and narrative before downstream decomposition happens.

Representative excerpt:

```md
---
kind: spec
spec_type: overview
name: octospark-overview-source
title: "Octospark Overview Source"
status: draft
version: 1
summary: "High-detail overview and business context source document for the Octospark rewrite."
domain: octospark
tags:
  - overview
  - requirements
  - product
  - example
plan: ~/.codex/plans/octospark-product-requirements.md
---

# Plan

Plan file: [~/.codex/plans/octospark-product-requirements.md](~/.codex/plans/octospark-product-requirements.md)

# Summary

This document is a high-fidelity overview source for the Octospark rewrite. It demonstrates how a project-level overview can retain market context, actors, launch scope, platform targets, governance constraints, and phased delivery decisions.

# Detailed Source Material

## Octospark — Business Requirements

## 1. What is Octospark?

Octospark is an autonomous social growth platform that makes organic social media as measurable and scalable as paid advertising.

### Target Audience

The primary audience is marketing teams and technical marketing professionals — social media managers, content marketers, brand managers, and small-to-mid-size marketing agencies.

## 3. Actors

| Actor | Description |
|-------|-------------|
| Social Media Manager | Primary day-to-day user |
| Campaign Manager | Plans and runs multi-post campaigns |
| Approver | Reviews scheduled content before it goes live |
| Team Admin | Manages membership and permissions |
| Organization Admin | Manages billing and org-wide settings |

## 4. High Level Features

- Social account management
- Media library
- AI content generation
- Scheduling and publishing
- Content approval workflow
- Campaigns and budgets
- Analytics
- Knowledge base
- Billing and pricing
- Team and role management

## 5. Platform Support

- TikTok: implemented
- Instagram: launch target
- Facebook: launch target
- LinkedIn: launch target
```

Use an overview like this when the user is still describing the product, the launch boundary, and the top-level system context. Do not prematurely force it into one subsystem's vocabulary.
