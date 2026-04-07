import { afterEach, beforeEach, expect, test } from "bun:test"

import { state } from "../src/lib/state"
import { server } from "../src/server"

const testModels = {
  object: "list",
  data: [
    {
      id: "gpt-4.1-2025-04-14",
      object: "model",
      name: "GPT-4.1",
      version: "2025-04-14",
      vendor: "openai",
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        object: "capabilities",
        type: "chat",
        family: "gpt-4.1",
        tokenizer: "o200k_base",
        limits: {
          max_context_window_tokens: 128000,
          max_output_tokens: 32768,
        },
        supports: {
          tool_calls: true,
          parallel_tool_calls: true,
          vision: true,
        },
      },
    },
  ],
} as const

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

test("preserves upstream OpenAI-style error envelopes for responses", async () => {
  globalThis.fetch = (() => {
    return new Response(
      JSON.stringify({
        error: {
          message: "The previous_response_id provided is invalid.",
          type: "invalid_request_error",
          param: "previous_response_id",
          code: "invalid_previous_response_id",
        },
      }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_responses_123",
        },
      },
    )
  }) as typeof fetch

  const response = await server.request("http://localhost/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-key",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      previous_response_id: "resp_missing",
      input: "hello",
    }),
  })

  expect(response.status).toBe(400)
  expect(response.headers.get("x-request-id")).toBe("req_responses_123")
  expect(await response.json()).toEqual({
    error: {
      message: "The previous_response_id provided is invalid.",
      type: "invalid_request_error",
      param: "previous_response_id",
      code: "invalid_previous_response_id",
    },
  })
})

test("preserves original response model names when forwarding", async () => {
  let forwardedBody: Record<string, unknown> | undefined

  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const requestBody = typeof init?.body === "string" ? init.body : "{}"
    forwardedBody = JSON.parse(requestBody) as Record<string, unknown>

    return new Response(JSON.stringify({ id: "resp_123" }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    })
  }) as typeof fetch

  const response = await server.request("http://localhost/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-key",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      input: "hello",
    }),
  })

  expect(response.status).toBe(200)
  expect(forwardedBody?.model).toBe("gpt-4.1")
})

test("mirrors request-id aliases for forwarded responses", async () => {
  globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify({ id: "resp_123" }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_responses_success_123",
      },
    })
  }) as typeof fetch

  const response = await server.request("http://localhost/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-key",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      input: "hello",
    }),
  })

  expect(response.status).toBe(200)
  expect(response.headers.get("x-request-id")).toBe("req_responses_success_123")
  expect(response.headers.get("request-id")).toBe("req_responses_success_123")
})
