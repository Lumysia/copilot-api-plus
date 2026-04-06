import { afterEach, beforeEach, expect, test } from "bun:test"

import { state } from "../src/lib/state"
import { server } from "../src/server"

const originalApiKey = state.apiKey

beforeEach(() => {
  state.authFailures.clear()
  state.apiKey = "test-key"
})

afterEach(() => {
  state.authFailures.clear()
  state.apiKey = originalApiKey
})

test("rejects request without presenting an API key", async () => {
  const response = await server.request("http://localhost/v1/models")

  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({
    error: {
      message: "Invalid API key",
      type: "authentication_error",
    },
  })
})

test("accepts bearer token authentication", async () => {
  const response = await server.request("http://localhost/", {
    headers: {
      Authorization: "Bearer test-key",
    },
  })

  expect(response.status).toBe(200)
  expect(await response.text()).toBe("Server running")
})

test("accepts x-api-key authentication", async () => {
  const response = await server.request("http://localhost/", {
    headers: {
      "x-api-key": "test-key",
    },
  })

  expect(response.status).toBe(200)
  expect(await response.text()).toBe("Server running")
})

test("allows requests when API key protection is disabled", async () => {
  state.apiKey = ""

  const response = await server.request("http://localhost/")

  expect(response.status).toBe(200)
  expect(await response.text()).toBe("Server running")
})

test("uses proxy headers for auth failure rate limiting", async () => {
  for (let index = 0; index < 10; index += 1) {
    const response = await server.request("http://localhost/v1/models", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 127.0.0.1",
      },
    })

    expect(response.status).toBe(401)
  }

  const blockedResponse = await server.request("http://localhost/v1/models", {
    headers: {
      "x-forwarded-for": "203.0.113.10, 127.0.0.1",
    },
  })

  expect(blockedResponse.status).toBe(429)
})

test("successful authentication clears previous auth failures", async () => {
  const failedResponse = await server.request("http://localhost/v1/models", {
    headers: {
      "x-real-ip": "198.51.100.1",
    },
  })

  expect(failedResponse.status).toBe(401)

  const successResponse = await server.request("http://localhost/", {
    headers: {
      Authorization: "Bearer test-key",
      "x-real-ip": "198.51.100.1",
    },
  })

  expect(successResponse.status).toBe(200)
  expect(state.authFailures.has("198.51.100.1")).toBe(false)
})
