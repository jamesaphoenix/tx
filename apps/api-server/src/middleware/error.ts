/**
 * Error Handling Middleware
 *
 * Provides consistent error responses across all API endpoints.
 */

import type { Context, Next } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { HTTPException } from "hono/http-exception"

/**
 * Standard API error response format.
 */
export interface ApiError {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

/**
 * Map error types to HTTP status codes.
 */
const getStatusCode = (error: unknown): ContentfulStatusCode => {
  if (error instanceof HTTPException) {
    return error.status as ContentfulStatusCode
  }

  // Handle tx-core errors by name
  if (error && typeof error === "object" && "_tag" in error) {
    const tag = (error as { _tag: string })._tag
    switch (tag) {
      case "TaskNotFoundError":
      case "LearningNotFoundError":
      case "FileLearningNotFoundError":
      case "AttemptNotFoundError":
        return 404
      case "ValidationError":
      case "CircularDependencyError":
        return 400
      case "DatabaseError":
        return 500
      case "EmbeddingUnavailableError":
        return 503
    }
  }

  return 500
}

/**
 * Extract error code from various error types.
 */
const getErrorCode = (error: unknown): string => {
  if (error && typeof error === "object" && "_tag" in error) {
    return (error as { _tag: string })._tag
  }
  if (error instanceof HTTPException) {
    return `HTTP_${error.status}`
  }
  return "INTERNAL_ERROR"
}

/**
 * Global error handling middleware.
 * Catches all errors and returns consistent JSON responses.
 */
export const errorHandler = async (c: Context, next: Next): Promise<Response> => {
  try {
    await next()
  } catch (error) {
    const status = getStatusCode(error)
    const code = getErrorCode(error)
    const message = error instanceof Error ? error.message : String(error)

    const body: ApiError = {
      error: {
        code,
        message
      }
    }

    // Include details for validation errors
    if (error && typeof error === "object" && "details" in error) {
      body.error.details = (error as { details: unknown }).details
    }

    return c.json(body, status)
  }

  // If no response was set by handler, return the response from context
  return c.res
}

/**
 * Not found handler for undefined routes.
 */
export const notFoundHandler = (c: Context): Response => {
  return c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: `Route ${c.req.method} ${c.req.path} not found`
      }
    } satisfies ApiError,
    404
  )
}
