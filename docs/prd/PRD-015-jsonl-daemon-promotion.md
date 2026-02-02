# PRD-015: Graph RAG - JSONL Telemetry Daemon and Knowledge Promotion Pipeline

## Overview

Background service that watches Claude Code transcripts (`~/.claude/projects/`), extracts learning candidates, and manages promotion to the knowledge layer.

## Problem Statement

- Claude Code sessions generate valuable insights in JSONL transcripts
- These are lost after session ends
- No automated extraction of learnings
- Manual `tx learning:add` is tedious
- Need pipeline from raw telemetry to curated knowledge

## Solution: Telemetry → Knowledge Pipeline

```
~/.claude/projects/**/*.jsonl
         ↓
   FileWatcher (chokidar)
         ↓
   Hash Check (skip processed)
         ↓
   Parse JSONL Transcript
         ↓
   LLM Candidate Extraction
         ↓
   Confidence Scoring (high/medium/low)
         ↓
   Promotion Gate
   ├── High confidence → Auto-promote to learnings
   └── Medium/Low → Queue for review
         ↓
   Create provenance edges (DERIVED_FROM)
```

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| DP-001 | Watch `~/.claude/projects/` for new/changed JSONL files | P0 |
| DP-002 | Hash-based deduplication (skip already processed files) | P0 |
| DP-003 | Extract learning candidates with LLM | P0 |
| DP-004 | Score confidence: high/medium/low | P0 |
| DP-005 | Auto-promote high-confidence candidates | P0 |
| DP-006 | Queue medium/low for human review | P1 |
| DP-007 | Link promoted learnings to source run/task | P0 |
| DP-008 | Run as background daemon (launchd/systemd) | P0 |
| DP-009 | Graceful degradation without LLM (queue only) | P1 |
| DP-010 | Rate limiting for LLM calls | P1 |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| DP-NFR-001 | Daemon startup time | <2s |
| DP-NFR-002 | File processing latency | <10s per file |
| DP-NFR-003 | Memory footprint | <100MB |
| DP-NFR-004 | Uptime | 99.9% |

## Data Model

### Migration: `006_telemetry_daemon.sql`

```sql
-- Track processed JSONL files
CREATE TABLE telemetry_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,  -- SHA256 of content
  file_size INTEGER NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  candidate_count INTEGER DEFAULT 0,
  error_message TEXT
);

CREATE INDEX idx_telemetry_hash ON telemetry_log(file_hash);
CREATE INDEX idx_telemetry_path ON telemetry_log(file_path);

-- Learning candidates awaiting promotion
CREATE TABLE learning_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  category TEXT,
  source_file TEXT NOT NULL,
  source_run_id TEXT,
  source_task_id TEXT,
  extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'promoted', 'rejected', 'merged')),
  reviewed_at TEXT,
  reviewed_by TEXT,  -- 'auto' or user identifier
  promoted_learning_id INTEGER,
  rejection_reason TEXT,
  FOREIGN KEY (promoted_learning_id) REFERENCES learnings(id)
);

CREATE INDEX idx_candidates_status ON learning_candidates(status);
CREATE INDEX idx_candidates_confidence ON learning_candidates(confidence);
CREATE INDEX idx_candidates_source ON learning_candidates(source_file);
```

## Candidate Extraction

### LLM Prompt

```
Analyze this Claude Code session transcript and extract actionable learnings.

<transcript>
{transcript_excerpt}
</transcript>

Extract learnings that meet these criteria:
1. **Technical decisions**: Describes a choice and its rationale
2. **Gotchas/pitfalls**: Something to avoid next time
3. **Patterns that worked**: Reusable approaches
4. **Future improvements**: Things to do differently

For each learning, provide:
- content: The learning text (1-3 sentences, actionable)
- confidence: "high" (certain, tested), "medium" (likely useful), "low" (speculative)
- category: One of [architecture, testing, performance, security, debugging, tooling, patterns]

Return JSON array:
[
  {
    "content": "Always wrap database operations in transactions to ensure atomicity",
    "confidence": "high",
    "category": "patterns"
  }
]

Rules:
- Skip generic advice (things any developer knows)
- Skip context-specific details that won't generalize
- Prefer actionable "do X when Y" format
- Maximum 5 learnings per transcript
```

### Confidence Scoring

| Confidence | Criteria | Action |
|------------|----------|--------|
| **High** | Tested in session, clear outcome | Auto-promote |
| **Medium** | Reasonable but unverified | Queue for review |
| **Low** | Speculative, edge case | Queue with low priority |

## API Surface

### CLI Commands

```bash
# Start daemon
tx daemon start

# Stop daemon
tx daemon stop

# Check daemon status
tx daemon status

# Process files manually (without daemon)
tx daemon process [--path ~/.claude/projects/]

# Review pending candidates
tx daemon review [--confidence medium,low]

# Promote a candidate manually
tx daemon promote <candidate-id>

# Reject a candidate
tx daemon reject <candidate-id> --reason "too specific"
```

### Service Interface

```typescript
interface TelemetryDaemonService {
  start: () => Effect<void, DaemonError>
  stop: () => Effect<void, DaemonError>
  status: () => Effect<DaemonStatus, DatabaseError>
  processFile: (path: string) => Effect<ProcessResult, ProcessingError>
}

interface CandidateService {
  list: (filter?: CandidateFilter) => Effect<LearningCandidate[], DatabaseError>
  promote: (id: number) => Effect<Learning, CandidateNotFoundError | DatabaseError>
  reject: (id: number, reason: string) => Effect<void, CandidateNotFoundError | DatabaseError>
  autoPromote: () => Effect<PromotionResult, DatabaseError>
}

interface DaemonStatus {
  running: boolean
  pid: number | null
  uptime: number | null
  filesProcessed: number
  candidatesExtracted: number
  candidatesPromoted: number
  lastProcessedAt: Date | null
  watchedPaths: string[]
}
```

## Daemon Architecture

### Process Model

```
tx daemon start
    │
    ├── Write PID to .tx/daemon.pid
    ├── Initialize file watcher (chokidar)
    ├── Spawn processing fiber (Effect background)
    │   └── Watch queue → Process file → Extract → Store
    └── Health check endpoint (optional)
```

### File Watcher

```typescript
const watchPaths = [
  `${os.homedir()}/.claude/projects/**/*.jsonl`
]

const watcher = chokidar.watch(watchPaths, {
  ignoreInitial: false,  // Process existing files on startup
  persistent: true,
  awaitWriteFinish: {
    stabilityThreshold: 2000,  // Wait for file to finish writing
    pollInterval: 100
  }
})

watcher.on('add', (path) => processQueue.offer(path))
watcher.on('change', (path) => processQueue.offer(path))
```

### Rate Limiting

```typescript
const rateLimiter = {
  maxConcurrent: 2,       // Max parallel LLM calls
  minInterval: 1000,      // 1s between calls
  maxPerMinute: 30,       // Burst limit
  backoffFactor: 2        // Exponential backoff on errors
}
```

## Promotion Logic

### Auto-Promotion Pipeline

```typescript
const autoPromote = (candidate: LearningCandidate) =>
  Effect.gen(function* () {
    // Only auto-promote high confidence
    if (candidate.confidence !== 'high') {
      return { status: 'skipped', reason: 'not high confidence' }
    }

    // Check for duplicates
    const similar = yield* learningService.search({
      query: candidate.content,
      limit: 5,
      minScore: 0.85
    })

    if (similar.length > 0) {
      // Mark as merged with existing
      yield* candidateRepo.update(candidate.id, {
        status: 'merged',
        promoted_learning_id: similar[0].id
      })
      return { status: 'merged', existingId: similar[0].id }
    }

    // Create learning
    const learning = yield* learningService.create({
      content: candidate.content,
      sourceType: 'run',
      sourceRef: candidate.sourceRunId,
      category: candidate.category
    })

    // Create provenance edge
    if (candidate.sourceRunId) {
      yield* graphService.addEdge({
        edgeType: 'DERIVED_FROM',
        sourceType: 'learning',
        sourceId: String(learning.id),
        targetType: 'run',
        targetId: candidate.sourceRunId,
        weight: 1.0
      })
    }

    // Update candidate status
    yield* candidateRepo.update(candidate.id, {
      status: 'promoted',
      promoted_learning_id: learning.id,
      reviewed_at: new Date().toISOString(),
      reviewed_by: 'auto'
    })

    return { status: 'promoted', learningId: learning.id }
  })
```

## Graceful Degradation

| Component | Failure | Fallback |
|-----------|---------|----------|
| LLM (Anthropic) | API unavailable | Queue file for later, no extraction |
| ast-grep | Not installed | Skip symbol extraction |
| File system | Watch fails | Periodic polling (60s) |
| SQLite | Locked | Retry with exponential backoff |

## System Integration

### launchd (macOS)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.tx.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/tx</string>
    <string>daemon</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/tx-daemon.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/tx-daemon.err</string>
</dict>
</plist>
```

### systemd (Linux)

```ini
[Unit]
Description=tx Telemetry Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/tx daemon run
Restart=always
RestartSec=5
User=%i

[Install]
WantedBy=multi-user.target
```

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Candidate extraction latency | <10s per file | p95 |
| High-confidence accuracy | >90% useful | Manual audit |
| Duplicate detection rate | 100% | No re-processing |
| Daemon uptime | 99.9% | Monitoring |
| Memory usage | <100MB | Prometheus |

## Dependencies

- **Depends on**: PRD-014 (Graph Schema for provenance edges)
- **Blocks**: PRD-016 (Graph Expansion needs populated graph)

## Security Considerations

1. **File access**: Only read from `~/.claude/projects/`, no arbitrary paths
2. **API keys**: Use existing ANTHROPIC_API_KEY, no new credentials
3. **PII filtering**: Strip user-identifiable info before LLM processing
4. **Rate limiting**: Prevent API cost runaway

## Resolved Questions

1. **Should we process historical files on first daemon start?**
   → **Yes, but capped.** Process last 7 days of files to bootstrap. Skip older files.

2. **How to handle very large transcripts (>100KB)?**
   → **Chunk with limits.** Process 400-500 lines at a time (~8K tokens max).
   - Track byte offset in `telemetry_progress` table
   - Resume from last position on next run
   - Use simple tokenizer heuristic (`chars / 4`) as default, pluggable for precision

3. **Should candidates expire after N days without review?**
   → **Yes, 30 days.** Auto-reject with reason "expired" after 30 days without review.

## Design Decisions

### Pluggable Extractor Interface

Extraction should be pluggable like embeddings and retrieval. Default uses Agent SDK.

```typescript
interface CandidateExtractor {
  extract(chunk: TranscriptChunk): Effect<LearningCandidate[], ExtractionError>
}

// Default: Claude via Agent SDK
const defaultExtractor = agentSdkExtractor({
  model: 'claude-sonnet-4-20250514',
  maxCandidates: 5
})

// User can swap
const tx = createTx({
  extractor: myCustomExtractor  // GPT, local model, rule-based, etc.
})
```

### File Position Tracking (No Duplicate Processing)

Track byte offset to avoid re-processing:

```sql
CREATE TABLE telemetry_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'claude',  -- 'claude', 'cursor', 'windsurf', etc.
  last_line_processed INTEGER DEFAULT 0,
  last_byte_offset INTEGER DEFAULT 0,
  file_size INTEGER,
  last_processed_at TEXT,
  checksum TEXT,
  UNIQUE(project_id, file_path)
);
```

### User Specifies Projects (Opt-in)

Daemon only watches explicitly tracked projects. No default watching.

```sql
CREATE TABLE daemon_tracked_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL UNIQUE,
  project_id TEXT,
  source_type TEXT DEFAULT 'claude',
  added_at TEXT DEFAULT (datetime('now')),
  enabled BOOLEAN DEFAULT 1
);
```

CLI:
```bash
tx daemon track ~/projects/my-app
tx daemon track ~/projects/my-app --source cursor
tx daemon list
tx daemon untrack ~/projects/my-app
```

### Simple Tokenizer (No tiktoken dependency)

For chunking, use simple heuristic. Exact counts not needed.

```typescript
interface Tokenizer {
  count(text: string): number
}

const defaultTokenizer: Tokenizer = {
  count: (text) => Math.ceil(text.length / 4)
}

// Pluggable for users who need precision
const tx = createTx({
  tokenizer: tiktokenTokenizer
})
```

## References

- DD-015: JSONL Daemon Implementation
- PRD-014: Graph Schema
- [chokidar documentation](https://github.com/paulmillr/chokidar)
