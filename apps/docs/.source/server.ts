// @ts-nocheck
import * as __fd_glob_15 from "../content/docs/primitives/tasks.mdx?collection=docs"
import * as __fd_glob_14 from "../content/docs/primitives/sync.mdx?collection=docs"
import * as __fd_glob_13 from "../content/docs/primitives/spec-trace.mdx?collection=docs"
import * as __fd_glob_12 from "../content/docs/primitives/spec-health.mdx?collection=docs"
import * as __fd_glob_11 from "../content/docs/primitives/skills.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/primitives/plans.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/primitives/label.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/primitives/invariants.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/primitives/docs.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/primitives/decision.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/migration.mdx?collection=docs"
import * as __fd_glob_4 from "../content/docs/interfaces.mdx?collection=docs"
import * as __fd_glob_3 from "../content/docs/index.mdx?collection=docs"
import * as __fd_glob_2 from "../content/docs/getting-started.mdx?collection=docs"
import { default as __fd_glob_1 } from "../content/docs/primitives/meta.json?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, "primitives/meta.json": __fd_glob_1, }, {"getting-started.mdx": __fd_glob_2, "index.mdx": __fd_glob_3, "interfaces.mdx": __fd_glob_4, "migration.mdx": __fd_glob_5, "primitives/decision.mdx": __fd_glob_6, "primitives/docs.mdx": __fd_glob_7, "primitives/invariants.mdx": __fd_glob_8, "primitives/label.mdx": __fd_glob_9, "primitives/plans.mdx": __fd_glob_10, "primitives/skills.mdx": __fd_glob_11, "primitives/spec-health.mdx": __fd_glob_12, "primitives/spec-trace.mdx": __fd_glob_13, "primitives/sync.mdx": __fd_glob_14, "primitives/tasks.mdx": __fd_glob_15, });