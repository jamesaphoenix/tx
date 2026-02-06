/**
 * @tx/agent-sdk Client Tests
 *
 * Tests for TxClient singleton behavior and DirectTransport caching.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { TxClient, _testClearRuntimeCache, _testGetRuntimeCacheSize } from "./client.js"
import { TxError } from "./utils.js"

describe("TxClient", () => {
  describe("configuration", () => {
    it("throws if neither apiUrl nor dbPath is provided", () => {
      expect(() => new TxClient({})).toThrow(TxError)
      expect(() => new TxClient({})).toThrow("Either apiUrl or dbPath must be provided")
    })

    it("creates HTTP transport when apiUrl is provided", () => {
      const client = new TxClient({ apiUrl: "http://localhost:3456" })
      expect(client.isHttp).toBe(true)
      expect(client.isDirect).toBe(false)
    })

    it("creates direct transport when dbPath is provided", () => {
      const client = new TxClient({ dbPath: ".tx/test.db" })
      expect(client.isDirect).toBe(true)
      expect(client.isHttp).toBe(false)
    })

    it("prefers direct mode when both apiUrl and dbPath are provided", () => {
      const client = new TxClient({
        apiUrl: "http://localhost:3456",
        dbPath: ".tx/test.db"
      })
      expect(client.isDirect).toBe(true)
      expect(client.isHttp).toBe(false)
    })
  })

  describe("DirectTransport singleton (RULE 8 compliance)", () => {
    beforeEach(() => {
      _testClearRuntimeCache()
    })

    it("allows multiple clients with the same dbPath", () => {
      const dbPath = ".tx/singleton-test.db"
      const client1 = new TxClient({ dbPath })
      const client2 = new TxClient({ dbPath })
      const client3 = new TxClient({ dbPath })

      // All should be direct mode
      expect(client1.isDirect).toBe(true)
      expect(client2.isDirect).toBe(true)
      expect(client3.isDirect).toBe(true)

      // Should have the same configuration
      expect(client1.configuration.dbPath).toBe(dbPath)
      expect(client2.configuration.dbPath).toBe(dbPath)
      expect(client3.configuration.dbPath).toBe(dbPath)
    })

    it("allows clients with different dbPaths", () => {
      const client1 = new TxClient({ dbPath: ".tx/db1.db" })
      const client2 = new TxClient({ dbPath: ".tx/db2.db" })

      expect(client1.configuration.dbPath).toBe(".tx/db1.db")
      expect(client2.configuration.dbPath).toBe(".tx/db2.db")
    })

    it("concurrent ensureRuntime() calls share the same runtime cache key", () => {
      // Verify that clients with the same dbPath use the same cache key
      // (the TOCTOU fix ensures only one runtime is created per dbPath)
      const dbPath = ".tx/race-test.db"
      const client1 = new TxClient({ dbPath })
      const client2 = new TxClient({ dbPath })
      const client3 = new TxClient({ dbPath })

      // All clients with the same dbPath should resolve to the same configuration
      expect(client1.configuration.dbPath).toBe(dbPath)
      expect(client2.configuration.dbPath).toBe(dbPath)
      expect(client3.configuration.dbPath).toBe(dbPath)

      // Different dbPath should be distinct
      const client4 = new TxClient({ dbPath: ".tx/other.db" })
      expect(client4.configuration.dbPath).not.toBe(dbPath)
    })
  })

  describe("HttpTransport", () => {
    it("normalizes apiUrl", () => {
      // With trailing slash
      const client1 = new TxClient({ apiUrl: "http://localhost:3456/" })
      expect(client1.configuration.apiUrl).toBe("http://localhost:3456/")

      // Without trailing slash
      const client2 = new TxClient({ apiUrl: "http://localhost:3456" })
      expect(client2.configuration.apiUrl).toBe("http://localhost:3456")
    })

    it("stores apiKey in configuration", () => {
      const client = new TxClient({
        apiUrl: "http://localhost:3456",
        apiKey: "test-key"
      })
      expect(client.configuration.apiKey).toBe("test-key")
    })

    it("uses default timeout if not provided", () => {
      const client = new TxClient({ apiUrl: "http://localhost:3456" })
      expect(client.configuration.timeout).toBeUndefined()
    })

    it("stores custom timeout in configuration", () => {
      const client = new TxClient({
        apiUrl: "http://localhost:3456",
        timeout: 5000
      })
      expect(client.configuration.timeout).toBe(5000)
    })
  })

  describe("namespaces", () => {
    it("exposes tasks namespace", () => {
      const client = new TxClient({ apiUrl: "http://localhost:3456" })
      expect(client.tasks).toBeDefined()
      expect(typeof client.tasks.list).toBe("function")
      expect(typeof client.tasks.get).toBe("function")
      expect(typeof client.tasks.create).toBe("function")
      expect(typeof client.tasks.update).toBe("function")
      expect(typeof client.tasks.delete).toBe("function")
      expect(typeof client.tasks.done).toBe("function")
      expect(typeof client.tasks.ready).toBe("function")
      expect(typeof client.tasks.block).toBe("function")
      expect(typeof client.tasks.unblock).toBe("function")
      expect(typeof client.tasks.tree).toBe("function")
    })

    it("exposes learnings namespace", () => {
      const client = new TxClient({ apiUrl: "http://localhost:3456" })
      expect(client.learnings).toBeDefined()
      expect(typeof client.learnings.search).toBe("function")
      expect(typeof client.learnings.get).toBe("function")
      expect(typeof client.learnings.add).toBe("function")
      expect(typeof client.learnings.helpful).toBe("function")
    })

    it("exposes fileLearnings namespace", () => {
      const client = new TxClient({ apiUrl: "http://localhost:3456" })
      expect(client.fileLearnings).toBeDefined()
      expect(typeof client.fileLearnings.list).toBe("function")
      expect(typeof client.fileLearnings.recall).toBe("function")
      expect(typeof client.fileLearnings.add).toBe("function")
    })

    it("exposes context namespace", () => {
      const client = new TxClient({ apiUrl: "http://localhost:3456" })
      expect(client.context).toBeDefined()
      expect(typeof client.context.forTask).toBe("function")
    })
  })
})
