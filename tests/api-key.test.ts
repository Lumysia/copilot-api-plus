import { afterEach, beforeEach, expect, test } from "bun:test"

import { state } from "../src/lib/state"
import { server } from "../src/server"

const originalApiKey = state.apiKey

beforeEach(() => {
  state.apiKey = "test-key"
})

afterEach(() => {
  state.apiKey = originalApiKey
})

test("rejects request without configured API key", async () => {
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
