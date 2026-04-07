import { test, expect, mock } from "bun:test"

import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { state } from "../src/lib/state"
import { createChatCompletions } from "../src/services/copilot/create-chat-completions"

// Mock state
state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"

// Helper to mock fetch
const fetchMock = mock(
  (
    _url: string,
    opts: { headers: Record<string, string> },
  ): {
    ok: boolean
    json: () => { id: string; object: string; choices: Array<never> }
    headers: Headers | Record<string, string>
  } => {
    return {
      ok: true,
      json: () => ({ id: "123", object: "chat.completion", choices: [] }),
      headers: opts.headers,
    }
  },
)
// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

function getLastForwardedRequest() {
  const lastCall = fetchMock.mock.calls.at(-1)
  if (!lastCall) {
    throw new Error("Expected fetch to be called")
  }

  return lastCall[1] as { headers: Record<string, string>; body: string }
}

test("sets X-Initiator to agent if tool/assistant present", async () => {
  fetchMock.mockClear()
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", content: "tool call" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = getLastForwardedRequest().headers
  expect(headers["X-Initiator"]).toBe("agent")
})

test("sets X-Initiator to user if only user present", async () => {
  fetchMock.mockClear()
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "user", content: "hello again" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = getLastForwardedRequest().headers
  expect(headers["X-Initiator"]).toBe("user")
})

test("maps max_completion_tokens to max_tokens before forwarding", async () => {
  fetchMock.mockClear()
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-test",
    max_completion_tokens: 321,
  }

  await createChatCompletions(payload)

  const forwardedBody = JSON.parse(
    getLastForwardedRequest().body,
  ) as ChatCompletionsPayload

  expect(forwardedBody.max_tokens).toBe(321)
  expect("max_completion_tokens" in forwardedBody).toBe(false)
})

test("uses max_completion_tokens for gpt-5 family models", async () => {
  fetchMock.mockClear()
  state.models = {
    object: "list",
    data: [
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

  await createChatCompletions({
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 321,
  })

  const forwardedBody = JSON.parse(
    getLastForwardedRequest().body,
  ) as ChatCompletionsPayload

  expect(forwardedBody.max_completion_tokens).toBe(321)
  expect("max_tokens" in forwardedBody).toBe(false)
})

test("normalizes developer role to system before forwarding", async () => {
  fetchMock.mockClear()
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "developer", content: "Behave like a shell." }],
    model: "gpt-test",
  }

  await createChatCompletions(payload)

  const forwardedBody = JSON.parse(
    getLastForwardedRequest().body,
  ) as ChatCompletionsPayload

  expect(forwardedBody.messages[0]?.role).toBe("system")
})

test("adds stream_options.include_usage for streaming requests", async () => {
  fetchMock.mockClear()
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "stream please" }],
    model: "gpt-test",
    stream: true,
  }

  await createChatCompletions(payload)

  const forwardedBody = JSON.parse(
    getLastForwardedRequest().body,
  ) as ChatCompletionsPayload

  expect(forwardedBody.stream_options).toEqual({ include_usage: true })
})

test("preserves caller stream options while forcing include_usage", async () => {
  fetchMock.mockClear()
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "stream please" }],
    model: "gpt-test",
    stream: true,
    stream_options: { include_usage: false },
  }

  await createChatCompletions(payload)

  const forwardedBody = JSON.parse(
    getLastForwardedRequest().body,
  ) as ChatCompletionsPayload

  expect(forwardedBody.stream_options).toEqual({ include_usage: true })
})

test("trims trailing whitespace from outbound message content", async () => {
  fetchMock.mockClear()

  await createChatCompletions({
    model: "gpt-test",
    messages: [
      { role: "user", content: "hello   \n\n" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "kept\t\t\n" },
          {
            type: "image_url",
            image_url: { url: "https://example.test/a.png" },
          },
        ],
      },
    ],
  })

  const forwardedBody = JSON.parse(
    getLastForwardedRequest().body,
  ) as ChatCompletionsPayload

  expect(forwardedBody.messages[0]?.content).toBe("hello")
  expect(forwardedBody.messages[1]?.content).toEqual([
    { type: "text", text: "kept" },
    { type: "image_url", image_url: { url: "https://example.test/a.png" } },
  ])
})

test("returns upstream headers alongside non-streaming responses", async () => {
  fetchMock.mockClear()
  fetchMock.mockImplementationOnce(
    (_url: string, opts: { headers: Record<string, string> }) => {
      return {
        ok: true,
        json: () => ({ id: "123", object: "chat.completion", choices: [] }),
        headers: new Headers({
          ...opts.headers,
          "x-request-id": "req_upstream_123",
        }),
      }
    },
  )

  const response = await createChatCompletions({
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-test",
  })

  if (!("body" in response)) {
    throw new TypeError("Expected non-streaming chat completion result")
  }

  expect(response.headers.get("x-request-id")).toBe("req_upstream_123")
  expect(response.body.id).toBe("123")
})
