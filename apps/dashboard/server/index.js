import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../../..");
const dbPath = resolve(projectRoot, ".tx/tasks.db");
const ralphLogPath = resolve(projectRoot, ".tx/ralph-output.log");
const ralphPidPath = resolve(projectRoot, ".tx/ralph.pid");
const txDir = resolve(projectRoot, ".tx");
/**
 * Validate that a file path is within the allowed .tx directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 * Returns the resolved absolute path if valid, null if invalid.
 */
const validatePathWithinTx = (filePath) => {
    const resolved = resolve(projectRoot, filePath);
    // Check that resolved path starts with the .tx directory
    if (!resolved.startsWith(txDir + "/") && resolved !== txDir) {
        return null;
    }
    return resolved;
};
const app = new Hono();
app.use("/*", cors());
// Lazy DB connection
let db = null;
const getDb = () => {
    if (!db) {
        if (!existsSync(dbPath)) {
            throw new Error(`Database not found at ${dbPath}. Run 'tx init' first.`);
        }
        db = new Database(dbPath, { readonly: true });
    }
    return db;
};
// Pagination helpers
function parseTaskCursor(cursor) {
    const colonIndex = cursor.lastIndexOf(':');
    return {
        score: parseInt(cursor.slice(0, colonIndex), 10),
        id: cursor.slice(colonIndex + 1),
    };
}
function parseRunCursor(cursor) {
    // Format: "2026-01-30T10:00:00Z:run-abc123"
    // Find the last colon that separates timestamp from id
    const match = cursor.match(/^(.+):(run-.+)$/);
    if (!match) {
        return { startedAt: cursor, id: '' };
    }
    return { startedAt: match[1], id: match[2] };
}
function buildTaskCursor(task) {
    return `${task.score}:${task.id}`;
}
function buildRunCursor(run) {
    return `${run.started_at}:${run.id}`;
}
// Helper to enrich tasks with dependency info
function enrichTasksWithDeps(db, tasks, allTasks) {
    // Get all dependencies
    const deps = db.prepare("SELECT blocker_id, blocked_id FROM task_dependencies").all();
    // Build maps
    const blockedByMap = new Map();
    const blocksMap = new Map();
    for (const dep of deps) {
        const existing = blockedByMap.get(dep.blocked_id) ?? [];
        blockedByMap.set(dep.blocked_id, [...existing, dep.blocker_id]);
        const existingBlocks = blocksMap.get(dep.blocker_id) ?? [];
        blocksMap.set(dep.blocker_id, [...existingBlocks, dep.blocked_id]);
    }
    // Build children map from all tasks if provided, otherwise query
    const tasksForChildren = allTasks ?? db.prepare("SELECT id, parent_id FROM tasks").all();
    const childrenMap = new Map();
    for (const task of tasksForChildren) {
        if (task.parent_id) {
            const existing = childrenMap.get(task.parent_id) ?? [];
            childrenMap.set(task.parent_id, [...existing, task.id]);
        }
    }
    // Status of all tasks for ready check
    const allTasksForStatus = allTasks ?? db.prepare("SELECT id, status FROM tasks").all();
    const statusMap = new Map(allTasksForStatus.map(t => [t.id, t.status]));
    const workableStatuses = ["backlog", "ready", "planning"];
    return tasks.map(task => {
        const blockedBy = blockedByMap.get(task.id) ?? [];
        const blocks = blocksMap.get(task.id) ?? [];
        const children = childrenMap.get(task.id) ?? [];
        const allBlockersDone = blockedBy.every(id => statusMap.get(id) === "done");
        const isReady = workableStatuses.includes(task.status) && allBlockersDone;
        return { ...task, blockedBy, blocks, children, isReady };
    });
}
// GET /api/tasks - with cursor-based pagination
app.get("/api/tasks", (c) => {
    try {
        const db = getDb();
        const cursor = c.req.query("cursor");
        const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);
        const statusFilter = c.req.query("status")?.split(",").filter(Boolean);
        const search = c.req.query("search");
        // Build WHERE clauses
        const conditions = [];
        const params = [];
        if (statusFilter?.length) {
            conditions.push(`status IN (${statusFilter.map(() => "?").join(",")})`);
            params.push(...statusFilter);
        }
        if (search) {
            conditions.push("(title LIKE ? OR description LIKE ?)");
            params.push(`%${search}%`, `%${search}%`);
        }
        if (cursor) {
            const { score, id } = parseTaskCursor(cursor);
            conditions.push("(score < ? OR (score = ? AND id > ?))");
            params.push(score, score, id);
        }
        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        // Fetch limit + 1 to check hasMore
        const sql = `
      SELECT * FROM tasks
      ${whereClause}
      ORDER BY score DESC, id ASC
      LIMIT ?
    `;
        params.push(limit + 1);
        const rows = db.prepare(sql).all(...params);
        const hasMore = rows.length > limit;
        const tasks = hasMore ? rows.slice(0, limit) : rows;
        // Get total count for display (without cursor condition)
        const countConditions = conditions.filter((_, i) => {
            // Remove cursor condition (last 3 params if cursor exists)
            return !cursor || i < conditions.length - 1;
        });
        const countParams = cursor ? params.slice(0, -4) : params.slice(0, -1); // Remove limit and cursor params
        const countWhereClause = countConditions.length ? `WHERE ${countConditions.join(" AND ")}` : "";
        const total = db.prepare(`SELECT COUNT(*) as count FROM tasks ${countWhereClause}`).get(...countParams).count;
        // Enrich with deps
        const enriched = enrichTasksWithDeps(db, tasks);
        // Summary (from all tasks matching filter, not just current page)
        const summaryRows = db.prepare(`SELECT status, COUNT(*) as count FROM tasks ${countWhereClause} GROUP BY status`).all(...countParams);
        const byStatus = summaryRows.reduce((acc, r) => {
            acc[r.status] = r.count;
            return acc;
        }, {});
        return c.json({
            tasks: enriched,
            nextCursor: hasMore && tasks.length ? buildTaskCursor(tasks[tasks.length - 1]) : null,
            hasMore,
            total,
            summary: { total, byStatus },
        });
    }
    catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});
// GET /api/tasks/ready - Returns ALL ready tasks (not paginated)
app.get("/api/tasks/ready", (c) => {
    try {
        const db = getDb();
        // Get all tasks to compute ready status and children
        const allTasks = db.prepare("SELECT * FROM tasks ORDER BY score DESC").all();
        const deps = db.prepare("SELECT blocker_id, blocked_id FROM task_dependencies").all();
        const blockedByMap = new Map();
        for (const dep of deps) {
            const existing = blockedByMap.get(dep.blocked_id) ?? [];
            blockedByMap.set(dep.blocked_id, [...existing, dep.blocker_id]);
        }
        const statusMap = new Map(allTasks.map(t => [t.id, t.status]));
        const workableStatuses = ["backlog", "ready", "planning"];
        // Filter to ready tasks
        const readyTasks = allTasks.filter(task => {
            const blockedBy = blockedByMap.get(task.id) ?? [];
            const allBlockersDone = blockedBy.every(id => statusMap.get(id) === "done");
            return workableStatuses.includes(task.status) && allBlockersDone;
        });
        // Enrich with full dependency info (Rule 1: every API response MUST include TaskWithDeps)
        const enriched = enrichTasksWithDeps(db, readyTasks, allTasks);
        return c.json({ tasks: enriched });
    }
    catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});
// GET /api/ralph
app.get("/api/ralph", (c) => {
    try {
        // Check if ralph is running
        let running = false;
        let pid = null;
        if (existsSync(ralphPidPath)) {
            const pidStr = readFileSync(ralphPidPath, "utf-8").trim();
            pid = parseInt(pidStr, 10);
            try {
                process.kill(pid, 0); // Check if process exists
                running = true;
            }
            catch {
                running = false;
            }
        }
        // Parse ralph log for recent activity
        const recentActivity = [];
        let currentIteration = 0;
        let currentTask = null;
        if (existsSync(ralphLogPath)) {
            const log = readFileSync(ralphLogPath, "utf-8");
            const lines = log.split("\n");
            for (const line of lines) {
                // Match iteration start
                const iterMatch = line.match(/\[([^\]]+)\] --- Iteration (\d+) ---/);
                if (iterMatch) {
                    currentIteration = parseInt(iterMatch[2], 10);
                }
                // Match task assignment
                const taskMatch = line.match(/\[([^\]]+)\] Task: (tx-[a-z0-9]+) — (.+)/);
                if (taskMatch) {
                    currentTask = taskMatch[2];
                    recentActivity.push({
                        timestamp: taskMatch[1],
                        iteration: currentIteration,
                        task: taskMatch[2],
                        taskTitle: taskMatch[3],
                        agent: "",
                        status: "started",
                    });
                }
                // Match agent
                const agentMatch = line.match(/\[([^\]]+)\] Agent: (.+)/);
                if (agentMatch && recentActivity.length > 0) {
                    recentActivity[recentActivity.length - 1].agent = agentMatch[2];
                }
                // Match completion
                const completeMatch = line.match(/\[([^\]]+)\] Agent completed successfully/);
                if (completeMatch && recentActivity.length > 0) {
                    recentActivity.push({
                        ...recentActivity[recentActivity.length - 1],
                        timestamp: completeMatch[1],
                        status: "completed",
                    });
                }
                // Match failure
                const failMatch = line.match(/\[([^\]]+)\] Agent failed/);
                if (failMatch && recentActivity.length > 0) {
                    recentActivity.push({
                        ...recentActivity[recentActivity.length - 1],
                        timestamp: failMatch[1],
                        status: "failed",
                    });
                }
            }
        }
        return c.json({
            running,
            pid,
            currentIteration,
            currentTask,
            recentActivity: recentActivity.slice(-20).reverse(), // Last 20, newest first
        });
    }
    catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});
// GET /api/stats
app.get("/api/stats", (c) => {
    try {
        const db = getDb();
        const taskCount = db.prepare("SELECT COUNT(*) as count FROM tasks").get().count;
        const doneCount = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'done'").get().count;
        const readyCount = db.prepare(`
      SELECT COUNT(*) as count FROM tasks t
      WHERE t.status IN ('backlog', 'ready', 'planning')
      AND NOT EXISTS (
        SELECT 1 FROM task_dependencies d
        JOIN tasks blocker ON d.blocker_id = blocker.id
        WHERE d.blocked_id = t.id AND blocker.status != 'done'
      )
    `).get().count;
        // Learnings count (if table exists)
        let learningsCount = 0;
        try {
            learningsCount = db.prepare("SELECT COUNT(*) as count FROM learnings").get().count;
        }
        catch {
            // Table doesn't exist yet
        }
        // Runs count (if table exists)
        let runsRunning = 0;
        let runsTotal = 0;
        try {
            runsRunning = db.prepare("SELECT COUNT(*) as count FROM runs WHERE status = 'running'").get().count;
            runsTotal = db.prepare("SELECT COUNT(*) as count FROM runs").get().count;
        }
        catch {
            // Table doesn't exist yet
        }
        return c.json({
            tasks: taskCount,
            done: doneCount,
            ready: readyCount,
            learnings: learningsCount,
            runsRunning,
            runsTotal,
        });
    }
    catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});
// GET /api/runs - List runs with cursor-based pagination
app.get("/api/runs", (c) => {
    try {
        const db = getDb();
        const cursor = c.req.query("cursor");
        const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);
        const agentFilter = c.req.query("agent");
        const statusFilter = c.req.query("status")?.split(",").filter(Boolean);
        // Build WHERE clauses
        const conditions = [];
        const params = [];
        if (agentFilter) {
            conditions.push("agent = ?");
            params.push(agentFilter);
        }
        if (statusFilter?.length) {
            conditions.push(`status IN (${statusFilter.map(() => "?").join(",")})`);
            params.push(...statusFilter);
        }
        if (cursor) {
            const { startedAt, id } = parseRunCursor(cursor);
            conditions.push("(started_at < ? OR (started_at = ? AND id > ?))");
            params.push(startedAt, startedAt, id);
        }
        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        let runs = [];
        try {
            const sql = `
        SELECT id, task_id, agent, started_at, ended_at, status, exit_code, transcript_path, summary, error_message
        FROM runs
        ${whereClause}
        ORDER BY started_at DESC, id ASC
        LIMIT ?
      `;
            params.push(limit + 1);
            runs = db.prepare(sql).all(...params);
        }
        catch {
            // Table doesn't exist yet
            return c.json({ runs: [], nextCursor: null, hasMore: false });
        }
        const hasMore = runs.length > limit;
        const pagedRuns = hasMore ? runs.slice(0, limit) : runs;
        // Enrich with task titles
        const enriched = pagedRuns.map(run => {
            let taskTitle = null;
            if (run.task_id) {
                const task = db.prepare("SELECT title FROM tasks WHERE id = ?").get(run.task_id);
                taskTitle = task?.title ?? null;
            }
            return { ...run, taskTitle };
        });
        return c.json({
            runs: enriched,
            nextCursor: hasMore && pagedRuns.length ? buildRunCursor(pagedRuns[pagedRuns.length - 1]) : null,
            hasMore,
        });
    }
    catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});
// GET /api/tasks/:id - Get task detail with related tasks
app.get("/api/tasks/:id", (c) => {
    try {
        const db = getDb();
        const id = c.req.param("id");
        const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
        if (!task) {
            return c.json({ error: "Task not found" }, 404);
        }
        // Get dependency info
        const blockedByIds = db.prepare("SELECT blocker_id FROM task_dependencies WHERE blocked_id = ?").all(id);
        const blocksIds = db.prepare("SELECT blocked_id FROM task_dependencies WHERE blocker_id = ?").all(id);
        const childIds = db.prepare("SELECT id FROM tasks WHERE parent_id = ?").all(id);
        // Fetch full task data for related tasks
        const fetchTasksByIds = (ids) => {
            if (ids.length === 0)
                return [];
            const placeholders = ids.map(() => "?").join(",");
            const tasks = db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...ids);
            return enrichTasksWithDeps(db, tasks);
        };
        const blockedByTasks = fetchTasksByIds(blockedByIds.map(r => r.blocker_id));
        const blocksTasks = fetchTasksByIds(blocksIds.map(r => r.blocked_id));
        const childTasks = fetchTasksByIds(childIds.map(r => r.id));
        // Enrich the main task
        const [enrichedTask] = enrichTasksWithDeps(db, [task]);
        return c.json({
            task: enrichedTask,
            blockedByTasks,
            blocksTasks,
            childTasks,
        });
    }
    catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});
// GET /api/runs/:id - Get run details with transcript
app.get("/api/runs/:id", (c) => {
    try {
        const db = getDb();
        const id = c.req.param("id");
        const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
        if (!run) {
            return c.json({ error: "Run not found" }, 404);
        }
        // Try to read transcript if it exists and path is valid
        let transcript = null;
        if (run.transcript_path) {
            const validatedPath = validatePathWithinTx(run.transcript_path);
            if (validatedPath && existsSync(validatedPath)) {
                transcript = readFileSync(validatedPath, "utf-8");
            }
        }
        return c.json({ run, transcript });
    }
    catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});
const port = 3001;
console.log(`Dashboard API running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
//# sourceMappingURL=index.js.map