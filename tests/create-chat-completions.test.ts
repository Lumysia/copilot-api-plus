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
  (_url: string, opts: { headers: Record<string, string> }) => {
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
