import { afterEach, beforeEach, expect, test } from "bun:test"

import { state } from "../src/lib/state"
import { server } from "../src/server"

const testModels = {
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
          thinking: true,
        },
      },
    },
    {
      id: "gpt-5.4",
      object: "model",
      name: "GPT-5.4",
      version: "2026-01-01",
      vendor: "openai",
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        object: "capabilities",
        type: "chat",
        family: "gpt-5",
        tokenizer: "o200k_base",
        limits: {
          max_context_window_tokens: 400000,
          max_output_tokens: 8192,
        },
        supports: {
          tool_calls: true,
          parallel_tool_calls: true,
          vision: true,
          thinking: true,
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

test("propagates anthropic request-id headers from upstream success responses", async () => {
  globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(
      JSON.stringify({
        id: "chatcmpl-anthropic-success",
        object: "chat.completion",
        created: 0,
        model: "gpt-4o-2024-05-13",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello from upstream",
            },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 4,
          total_tokens: 7,
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_anthropic_success_123",
          "anthropic-processing-ms": "24",
        },
      },
    )
  }) as unknown as typeof fetch

  const response = await server.request("http://localhost/v1/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-key",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 32,
      messages: [{ role: "user", content: "hello" }],
    }),
  })

  expect(response.status).toBe(200)
  expect(response.headers.get("request-id")).toBe("req_anthropic_success_123")
  expect(response.headers.get("anthropic-request-id")).toBe(
    "req_anthropic_success_123",
  )
  expect(response.headers.get("anthropic-processing-ms")).toBe("24")
})

test("converts upstream OpenAI error envelopes into Anthropic error envelopes", async () => {
  globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
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
          "x-request-id": "req_anthropic_error_123",
        },
      },
    )
  }) as unknown as typeof fetch

  const response = await server.request("http://localhost/v1/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-key",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "gpt-missing",
      max_tokens: 32,
      messages: [{ role: "user", content: "hello" }],
    }),
  })

  expect(response.status).toBe(404)
  expect(response.headers.get("request-id")).toBe("req_anthropic_error_123")
  expect(response.headers.get("anthropic-request-id")).toBe(
    "req_anthropic_error_123",
  )
  expect(await response.json()).toEqual({
    type: "error",
    error: {
      type: "invalid_request_error",
      message: "The model `gpt-missing` does not exist",
    },
  })
})

test("forwards anthropic max_tokens as max_completion_tokens for gpt-5 models", async () => {
  let forwardedBody: Record<string, unknown> | undefined

  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const requestBody = typeof init?.body === "string" ? init.body : "{}"
    forwardedBody = JSON.parse(requestBody) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: "chatcmpl-anthropic-gpt5",
        object: "chat.completion",
        created: 0,
        model: "gpt-5.4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello from GPT-5",
            },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 4,
          total_tokens: 7,
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    )
  }) as unknown as typeof fetch

  const response = await server.request("http://localhost/v1/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-key",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "gpt-5.4",
      max_tokens: 32,
      messages: [{ role: "user", content: "hello" }],
    }),
  })

  expect(response.status).toBe(200)
  expect(forwardedBody?.max_completion_tokens).toBe(32)
  expect(forwardedBody?.max_tokens).toBeUndefined()
})
