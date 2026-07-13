import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// All docs pages are prerendered (SSG, no revalidate), so serve them from the
// read-only static assets cache. Without this, cache misses fall through to
// on-demand rendering, which breaks pages that read the monorepo fs at build
// time (lib/mcp-tool-count.ts).
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
