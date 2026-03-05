/**
 * Pin row-to-entity mapper.
 */

import type { Pin, PinRow } from "@jamesaphoenix/tx-types"
import { coerceDbResult } from "../utils/db-result.js"

export const rowToPin = (row: PinRow): Pin => ({
  id: coerceDbResult<Pin["id"]>(row.id),
  content: row.content,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})
