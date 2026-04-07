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

test("accepts max_completion_tokens on chat completions requests", async () => {
  let forwardedBody: Record<string, unknown> | undefined

  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const requestBody = typeof init?.body === "string" ? init.body : "{}"
    forwardedBody = JSON.parse(requestBody) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "gpt-test",
        choices: [],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    )
  }) as typeof fetch

  const response = await server.request(
    "http://localhost/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_completion_tokens: 77,
        messages: [{ role: "user", content: "hello" }],
      }),
    },
  )

  expect(response.status).toBe(200)
  expect(forwardedBody?.max_tokens).toBe(77)
})

test("rejects unknown chat completion models before forwarding", async () => {
  let forwardedBody: Record<string, unknown> | undefined

  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const requestBody = typeof init?.body === "string" ? init.body : "{}"
    forwardedBody = JSON.parse(requestBody) as Record<string, unknown>

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
        },
      },
    )
  }) as typeof fetch

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

  expect(forwardedBody?.model).toBe("gpt-missing")
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({
    error: {
      message: "The model `gpt-missing` does not exist",
      type: "invalid_request_error",
      param: "model",
      code: "model_not_found",
    },
  })
})

test("propagates request-id aliases for successful chat completions", async () => {
  globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "gpt-test",
        choices: [],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_chat_success_123",
          "openai-processing-ms": "42",
        },
      },
    )
  }) as typeof fetch

  const response = await server.request(
    "http://localhost/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hello" }],
      }),
    },
  )

  expect(response.status).toBe(200)
  expect(response.headers.get("x-request-id")).toBe("req_chat_success_123")
  expect(response.headers.get("request-id")).toBe("req_chat_success_123")
  expect(response.headers.get("openai-processing-ms")).toBe("42")
})

test("terminates streaming chat completions with a single done sentinel", async () => {
  globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(
      [
        'data: {"id":"chatcmpl-stream","object":"chat.completion.chunk","created":0,"model":"gpt-test","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"chatcmpl-stream","object":"chat.completion.chunk","created":0,"model":"gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"stop","logprobs":null}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
      ].join(""),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req_chat_stream_123",
        },
      },
    )
  }) as typeof fetch

  const response = await server.request(
    "http://localhost/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    },
  )

  const body = await response.text()

  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toContain("text/event-stream")
  expect(response.headers.get("x-request-id")).toBe("req_chat_stream_123")
  expect(response.headers.get("request-id")).toBe("req_chat_stream_123")
  expect(body.match(/data: \[DONE\]/g)?.length).toBe(1)
})
