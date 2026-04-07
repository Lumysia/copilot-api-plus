import { afterEach, beforeEach, expect, test } from "bun:test"

import type { ModelsResponse } from "../src/services/copilot/get-models"

import { state } from "../src/lib/state"
import { server } from "../src/server"

const testModels: ModelsResponse = {
  object: "list",
  data: [
    {
      id: "gpt-4o-2024-05-13",
      object: "model",
      name: "GPT-4o",
      version: "2024-05-13",
      vendor: "openai",
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        object: "capabilities",
        type: "chat",
        family: "gpt-4o",
        tokenizer: "o200k_base",
        limits: {
          max_context_window_tokens: 128000,
          max_output_tokens: 4096,
        },
        supports: {
          tool_calls: true,
          parallel_tool_calls: true,
          vision: true,
        },
      },
    },
  ],
}

const originalApiKey = state.apiKey
const originalModels = state.models
const originalFetch = globalThis.fetch

beforeEach(() => {
  state.apiKey = "test-key"
  state.copilotToken = "test-token"
  state.vsCodeVersion = "1.0.0"
  state.accountType = "individual"
  state.models = structuredClone(testModels)
})

afterEach(() => {
  state.apiKey = originalApiKey
  state.models = originalModels
  globalThis.fetch = originalFetch
})

test("returns upstream-style error envelopes for locally rejected chat completion models", async () => {
  globalThis.fetch = (() => {
    return new Response(
      JSON.stringify({
        error: {
          message: "The model `gpt-missing` does not exist",
          type: "invalid_request_error",
          param: "model",
          code: "model_not_found",
        },
      }),
      {
        status: 404,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_test_123",
        },
      },
    )
  }) as unknown as typeof fetch

  const response = await server.request(
    "http://localhost/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-missing",
        messages: [{ role: "user", content: "hello" }],
      }),
    },
  )

  expect(response.status).toBe(404)
  expect(response.headers.get("x-request-id")).toBe("req_test_123")
  expect(await response.json()).toEqual({
    error: {
      message: "The model `gpt-missing` does not exist",
      type: "invalid_request_error",
      param: "model",
      code: "model_not_found",
    },
  })
})
