import type { SqliteDatabase } from "../../db.js"
import type { TaskRepositoryService } from "../task-repo.js"
import { createTaskRepositoryReadService } from "./read.js"
import { createTaskRepositoryWriteService } from "./write.js"

export const createTaskRepository = (db: SqliteDatabase): TaskRepositoryService => ({
  ...createTaskRepositoryReadService(db),
  ...createTaskRepositoryWriteService(db),
})
