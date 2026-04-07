import { afterEach, beforeEach, expect, mock, test } from "bun:test"

import { state } from "../src/lib/state"
import {
  createResponses,
  type ResponsesPayload,
} from "../src/services/copilot/create-responses"

const originalFetch = globalThis.fetch

beforeEach(() => {
  state.copilotToken = "test-token"
  state.vsCodeVersion = "1.0.0"
  state.accountType = "individual"
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function getRequestInit(callIndex: number = 0): RequestInit {
  return (fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined) ?? {}
}

function parseRequestBody(callIndex: number = 0): ResponsesPayload {
  const body = getRequestInit(callIndex).body

  if (typeof body !== "string") {
    throw new TypeError("Expected request body to be a JSON string")
  }

  return JSON.parse(body) as ResponsesPayload
}

let fetchMock: ReturnType<typeof mock>

test("posts payload to copilot responses endpoint", async () => {
  const responseBody = JSON.stringify({ id: "resp_123", object: "response" })
  fetchMock = mock((_url: string, _opts?: RequestInit) =>
    Promise.resolve(
      new Response(responseBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch

  const payload: ResponsesPayload = {
    model: "gpt-4.1",
    input: "hello",
  }

  const response = await createResponses(payload)

  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    "https://api.githubcopilot.com/responses",
  )
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
  })
  expect(await response.json()).toEqual({ id: "resp_123", object: "response" })
})

test("normalizes responses payload toward copilot upstream semantics", async () => {
  fetchMock = mock((_url: string, _opts?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify({ id: "resp_456", object: "response" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch

  await createResponses({
    model: "gpt-4.1",
    max_tokens: 321,
    input: [
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "system rule" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "prior answer" }],
      },
    ],
  })

  const requestInit = getRequestInit()
  const headers = new Headers(requestInit.headers)
  const requestBody = parseRequestBody()

  expect(headers.get("X-Initiator")).toBe("agent")
  expect(requestBody.max_output_tokens).toBe(321)
  expect("max_tokens" in requestBody).toBe(false)
  expect(requestBody.store).toBe(false)
  expect(requestBody.truncation).toBe("disabled")
  expect(requestBody.include).toContain("reasoning.encrypted_content")
  expect(requestBody.input).toEqual([
    {
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: "system rule" }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "prior answer" }],
    },
  ])
})

test("normalizes responses tools and tool_choice to upstream wire shape", async () => {
  fetchMock = mock((_url: string, _opts?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify({ id: "resp_tools", object: "response" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch

  await createResponses({
    model: "gpt-4.1",
    input: "hello",
    tools: [
      {
        type: "function",
        function: {
          name: "search_workspace",
          description: "Search the workspace",
        },
      },
      {
        type: "function",
        name: "read_file",
      },
    ],
    tool_choice: {
      type: "function",
      function: {
        name: "search_workspace",
      },
    },
  })

  const requestBody = parseRequestBody() as ResponsesPayload & {
    tools: Array<Record<string, unknown>>
    tool_choice: Record<string, unknown>
  }

  expect(requestBody.tools).toEqual([
    {
      type: "function",
      name: "search_workspace",
      description: "Search the workspace",
      strict: false,
      parameters: {},
    },
    {
      type: "function",
      name: "read_file",
      strict: false,
      parameters: {},
    },
  ])
  expect(requestBody.tool_choice).toEqual({
    type: "function",
    name: "search_workspace",
  })
})

test("preserves caller supplied responses-specific fields", async () => {
  fetchMock = mock((_url: string, _opts?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify({ id: "resp_789", object: "response" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch

  await createResponses({
    model: "gpt-4.1",
    previous_response_id: "resp_prev",
    max_output_tokens: 111,
    truncation: "auto",
    include: ["file_search_call.results"],
    reasoning: { effort: "high", summary: "detailed" },
    store: true,
    input: "hello",
  })

  const requestBody = parseRequestBody()

  expect(requestBody.previous_response_id).toBe("resp_prev")
  expect(requestBody.max_output_tokens).toBe(111)
  expect(requestBody.truncation).toBe("auto")
  expect(requestBody.store).toBe(true)
  expect(requestBody.reasoning).toEqual({ effort: "high", summary: "detailed" })
  expect(requestBody.include).toEqual([
    "file_search_call.results",
    "reasoning.encrypted_content",
  ])
})

test("preserves streaming response metadata", async () => {
  fetchMock = mock((_url: string, _opts?: RequestInit) =>
    Promise.resolve(
      new Response("data: hello\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    ),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch

  const response = await createResponses({
    model: "gpt-4.1",
    input: "hello",
    stream: true,
  })

  expect(response.headers.get("content-type")).toBe("text/event-stream")
  expect(await response.text()).toBe("data: hello\n\n")
})
