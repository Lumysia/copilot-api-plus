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
    {
      id: "claude-sonnet-4.6",
      object: "model",
      name: "Claude Sonnet 4.6",
      version: "2026-01-01",
      vendor: "anthropic",
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        object: "capabilities",
        type: "chat",
        family: "claude-sonnet-4",
        tokenizer: "claude",
        limits: {
          max_context_window_tokens: 200000,
          max_output_tokens: 8192,
        },
        supports: {
          tool_calls: true,
          parallel_tool_calls: true,
          vision: true,
          thinking: true,
          min_thinking_budget: 1024,
          max_thinking_budget: 32000,
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

test("requests upstream reasoning fields for `/v1/messages` when anthropic thinking is enabled", async () => {
  let forwardedBody: Record<string, unknown> | undefined

  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const requestBody = typeof init?.body === "string" ? init.body : "{}"
    forwardedBody = JSON.parse(requestBody) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: "chatcmpl-anthropic-thinking",
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
      thinking: { type: "enabled", budget_tokens: 16 },
      messages: [{ role: "user", content: "hello" }],
    }),
  })

  expect(response.status).toBe(200)
  expect(forwardedBody?.reasoning).toEqual({ summary: "detailed" })
  expect(forwardedBody?.include).toEqual(["reasoning.encrypted_content"])
})

test("routes claude `/v1/messages` requests to upstream messages api", async () => {
  let forwardedUrl: string | undefined
  let forwardedBody: Record<string, unknown> | undefined
  let forwardedHeaders: Headers | undefined

  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    if (typeof url === "string") {
      forwardedUrl = url
    } else if (url instanceof URL) {
      forwardedUrl = url.toString()
    } else {
      forwardedUrl = url.url
    }
    forwardedHeaders = new Headers(init?.headers)
    const requestBody = typeof init?.body === "string" ? init.body : "{}"
    forwardedBody = JSON.parse(requestBody) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: "msg_claude_thinking",
        type: "message",
        role: "assistant",
        model: "Claude Sonnet 4.6",
        content: [
          {
            type: "thinking",
            thinking: "Need arithmetic reasoning.",
            signature: "sig_123",
          },
          {
            type: "text",
            text: "323",
          },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 12,
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_claude_123",
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
      model: "claude-sonnet-4.6",
      max_tokens: 256,
      thinking: { type: "enabled", budget_tokens: 128 },
      messages: [{ role: "user", content: "what is 17*19?" }],
    }),
  })

  expect(response.status).toBe(200)
  expect(forwardedUrl).toBe("https://api.githubcopilot.com/v1/messages")
  expect(forwardedHeaders?.get("anthropic-beta")).toContain(
    "interleaved-thinking-2025-05-14",
  )
  expect(forwardedBody).toMatchObject({
    model: "claude-sonnet-4.6",
    thinking: { type: "enabled", budget_tokens: 1024 },
  })

  expect(await response.json()).toEqual({
    id: "msg_claude_thinking",
    type: "message",
    role: "assistant",
    model: "Claude Sonnet 4.6",
    content: [
      {
        type: "thinking",
        thinking: "Need arithmetic reasoning.",
        signature: "sig_123",
      },
      {
        type: "text",
        text: "323",
      },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 12,
    },
  })
})

test("normalizes claude thinking budget to upstream minimum for messages api", async () => {
  let forwardedBody: Record<string, unknown> | undefined

  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const requestBody = typeof init?.body === "string" ? init.body : "{}"
    forwardedBody = JSON.parse(requestBody) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: "msg_claude_budget",
        type: "message",
        role: "assistant",
        model: "Claude Sonnet 4.6",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
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
      model: "claude-sonnet-4.6",
      max_tokens: 256,
      thinking: { type: "enabled", budget_tokens: 128 },
      messages: [{ role: "user", content: "hello" }],
    }),
  })

  expect(response.status).toBe(200)
  expect(forwardedBody?.thinking).toEqual({
    type: "enabled",
    budget_tokens: 1024,
  })
})

test("adds context-management beta when forwarding anthropic context_management", async () => {
  let forwardedBody: Record<string, unknown> | undefined
  let forwardedHeaders: Headers | undefined

  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    forwardedHeaders = new Headers(init?.headers)
    const requestBody = typeof init?.body === "string" ? init.body : "{}"
    forwardedBody = JSON.parse(requestBody) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: "msg_claude_context_management",
        type: "message",
        role: "assistant",
        model: "Claude Sonnet 4.6",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
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
      model: "claude-sonnet-4.6",
      max_tokens: 256,
      context_management: {
        edits: [
          {
            type: "clear_tool_uses_20250919",
            trigger: { type: "input_tokens", value: 100000 },
            keep: { type: "tool_uses", value: 3 },
          },
        ],
      },
      messages: [{ role: "user", content: "hello" }],
    }),
  })

  expect(response.status).toBe(200)
  expect(forwardedHeaders?.get("anthropic-beta")).toContain(
    "context-management-2025-06-27",
  )
  expect(forwardedBody?.context_management).toEqual({
    edits: [
      {
        type: "clear_tool_uses_20250919",
        trigger: { type: "input_tokens", value: 100000 },
        keep: { type: "tool_uses", value: 3 },
      },
    ],
  })
})

test("streams claude messages api events without chat-completions translation", async () => {
  globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(
      [
        "event: message_start\n",
        'data: {"type":"message_start","message":{"id":"msg_stream","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4.6","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n',
        "event: content_block_start\n",
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"Plan"}}\n\n',
      ].join(""),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req_claude_stream_123",
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
      model: "claude-sonnet-4.6",
      stream: true,
      max_tokens: 256,
      thinking: { type: "enabled", budget_tokens: 128 },
      messages: [{ role: "user", content: "why sky blue" }],
    }),
  })

  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toBe("text/event-stream")
  const body = await response.text()
  expect(body).toContain("event: content_block_start")
  expect(body).toContain('"type":"thinking"')
})
