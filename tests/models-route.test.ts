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
    {
      id: "claude-sonnet-4.5-20250929",
      object: "model",
      name: "Claude Sonnet 4.5",
      version: "2025-09-29",
      vendor: "anthropic",
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        object: "capabilities",
        type: "chat",
        family: "claude-sonnet-4.5",
        tokenizer: "claude",
        limits: {
          max_context_window_tokens: 200000,
          max_output_tokens: 8192,
        },
        supports: {
          tool_calls: true,
          parallel_tool_calls: true,
        },
      },
    },
  ],
} as const

const originalApiKey = state.apiKey
const originalModels = state.models

beforeEach(() => {
  state.apiKey = "test-key"
  state.models = structuredClone(testModels)
})

afterEach(() => {
  state.apiKey = originalApiKey
  state.models = originalModels
})

test("lists canonical models with enriched capabilities metadata", async () => {
  const response = await server.request("http://localhost/v1/models", {
    headers: {
      Authorization: "Bearer test-key",
    },
  })

  expect(response.status).toBe(200)

  const json = (await response.json()) as {
    object: string
    data: Array<Record<string, unknown>>
    has_more: boolean
  }

  expect(json.object).toBe("list")
  expect(json.has_more).toBe(false)

  const gptModel = json.data.find((model) => model.id === "gpt-4o-2024-05-13")
  expect(gptModel).toMatchObject({
    id: "gpt-4o-2024-05-13",
    root: "gpt-4o-2024-05-13",
    parent: null,
    canonical_model_id: "gpt-4o-2024-05-13",
  })
  expect(gptModel?.capabilities).toMatchObject({
    family: "gpt-4o",
    supports: {
      streaming: true,
      tool_calls: true,
      parallel_tool_calls: true,
      vision: true,
    },
  })

  const claudeModel = json.data.find(
    (model) => model.id === "claude-sonnet-4.5-20250929",
  )
  expect(claudeModel).toMatchObject({
    id: "claude-sonnet-4.5-20250929",
    root: "claude-sonnet-4.5-20250929",
    parent: null,
    canonical_model_id: "claude-sonnet-4.5-20250929",
  })
  expect(claudeModel?.capabilities).toMatchObject({
    family: "claude-sonnet-4.5",
    supports: {
      streaming: true,
      tool_calls: true,
      parallel_tool_calls: true,
      vision: false,
      reasoning: true,
    },
  })

  expect(json.data).toHaveLength(3)
})

test("lists Claude family aliases that resolve to the same canonical model", async () => {
  const response = await server.request("http://localhost/v1/models", {
    headers: {
      Authorization: "Bearer test-key",
    },
  })

  expect(response.status).toBe(200)

  const json = (await response.json()) as {
    object: string
    data: Array<Record<string, unknown>>
    has_more: boolean
  }

  const familyAlias = json.data.find(
    (model) => model.id === "claude-sonnet-4.5",
  )
  expect(familyAlias).toMatchObject({
    id: "claude-sonnet-4.5",
    root: "claude-sonnet-4.5-20250929",
    canonical_model_id: "claude-sonnet-4.5-20250929",
  })

  const displayAlias = json.data.find(
    (model) => model.id === "claude-sonnet-4.5",
  )
  expect(displayAlias).toBeDefined()
})
