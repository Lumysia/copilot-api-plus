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

test("posts payload to copilot responses endpoint", async () => {
  const responseBody = JSON.stringify({ id: "resp_123", object: "response" })
  const fetchMock = mock((_url: string, _opts?: RequestInit) =>
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

test("preserves streaming response metadata", async () => {
  const fetchMock = mock((_url: string, _opts?: RequestInit) =>
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
