// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"getting-started.mdx": () => import("../content/docs/getting-started.mdx?collection=docs"), "index.mdx": () => import("../content/docs/index.mdx?collection=docs"), "interfaces.mdx": () => import("../content/docs/interfaces.mdx?collection=docs"), "migration.mdx": () => import("../content/docs/migration.mdx?collection=docs"), "primitives/docs.mdx": () => import("../content/docs/primitives/docs.mdx?collection=docs"), "primitives/invariants.mdx": () => import("../content/docs/primitives/invariants.mdx?collection=docs"), "primitives/label.mdx": () => import("../content/docs/primitives/label.mdx?collection=docs"), "primitives/plans.mdx": () => import("../content/docs/primitives/plans.mdx?collection=docs"), "primitives/skills.mdx": () => import("../content/docs/primitives/skills.mdx?collection=docs"), "primitives/spec-health.mdx": () => import("../content/docs/primitives/spec-health.mdx?collection=docs"), "primitives/spec-trace.mdx": () => import("../content/docs/primitives/spec-trace.mdx?collection=docs"), "primitives/sync.mdx": () => import("../content/docs/primitives/sync.mdx?collection=docs"), "primitives/tasks.mdx": () => import("../content/docs/primitives/tasks.mdx?collection=docs"), }),
};
export default browserCollections;