/**
 * Pin row-to-entity mapper.
 */

import type { Pin, PinRow } from "@jamesaphoenix/tx-types"

export const rowToPin = (row: PinRow): Pin => ({
  id: row.id as Pin["id"],
  content: row.content,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})
