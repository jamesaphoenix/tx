// File learning types for path-based knowledge storage
// See task tx-2e891c18 for specification

export type FileLearningId = number & { readonly _brand: unique symbol }

export interface FileLearning {
  readonly id: FileLearningId
  readonly filePattern: string
  readonly note: string
  readonly taskId: string | null
  readonly createdAt: Date
}

export interface CreateFileLearningInput {
  readonly filePattern: string
  readonly note: string
  readonly taskId?: string | null
}

// DB row type (snake_case from SQLite)
export interface FileLearningRow {
  id: number
  file_pattern: string
  note: string
  task_id: string | null
  created_at: string
}

export const rowToFileLearning = (row: FileLearningRow): FileLearning => ({
  id: row.id as FileLearningId,
  filePattern: row.file_pattern,
  note: row.note,
  taskId: row.task_id,
  createdAt: new Date(row.created_at)
})
