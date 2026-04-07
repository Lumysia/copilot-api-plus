import { afterEach, beforeEach, expect, mock, test } from "bun:test"

import { state } from "../src/lib/state"
import {
  createEmbeddings,
  type EmbeddingRequest,
} from "../src/services/copilot/create-embeddings"

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

function parseRequestBody(callIndex: number = 0): Record<string, unknown> {
  const body = getRequestInit(callIndex).body

  if (typeof body !== "string") {
    throw new TypeError("Expected request body to be a JSON string")
  }

  return JSON.parse(body) as Record<string, unknown>
}

let fetchMock: ReturnType<typeof mock>

test("translates OpenAI embeddings request into Copilot upstream wire format", async () => {
  fetchMock = mock((_url: string, _opts?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          model: "text-embedding-3-small",
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 2, total_tokens: 2 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    ),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch

  const payload: EmbeddingRequest = {
    model: "text-embedding-3-small",
    input: "hello world",
  }

  const response = await createEmbeddings(payload)
  const requestBody = parseRequestBody()

  expect(requestBody).toEqual({
    model: "text-embedding-3-small",
    input: ["hello world"],
    dimensions: 512,
  })
  expect(response).toEqual({
    object: "list",
    data: [
      {
        object: "embedding",
        embedding: [0.1, 0.2, 0.3],
        index: 0,
      },
    ],
    model: "text-embedding-3-small",
    usage: {
      prompt_tokens: 2,
      total_tokens: 2,
    },
  })
})

test("preserves array input and caller-supplied dimensions", async () => {
  fetchMock = mock((_url: string, _opts?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          model: "text-embedding-3-small",
          data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
          usage: { prompt_tokens: 4, total_tokens: 4 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    ),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch

  await createEmbeddings({
    model: "text-embedding-3-small",
    input: ["hello", "world"],
    dimensions: 256,
  })

  expect(parseRequestBody()).toEqual({
    model: "text-embedding-3-small",
    input: ["hello", "world"],
    dimensions: 256,
  })
})
