#!/usr/bin/env node
/**
 * TX API Server CLI Entry Point
 *
 * This module auto-starts the server when executed directly.
 * For library usage without auto-start, import from '@tx/api-server' instead.
 *
 * Usage:
 *   tx-api                      # Start with default settings
 *   tx-api --port 3000          # Start on specific port
 *   tx-api --db /path/to.db     # Start with custom database path
 */

import { main } from "./server-lib.js"

main()
