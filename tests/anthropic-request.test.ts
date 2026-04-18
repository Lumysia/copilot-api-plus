import { describe, test, expect } from "bun:test"
import { z } from "zod"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"

import { translateToOpenAI } from "../src/routes/messages/non-stream-translation"

// Zod schema for a single message in the chat completion request.
const messageSchema = z.object({
  role: z.enum([
    "system",
    "user",
    "assistant",
    "tool",
    "function",
    "developer",
  ]),
  content: z.union([z.string(), z.object({}), z.array(z.any())]),
  name: z.string().optional(),
  tool_calls: z.array(z.any()).optional(),
  tool_call_id: z.string().optional(),
})

// Zod schema for the entire chat completion request payload.
// This is derived from the openapi.documented.yml specification.
const chatCompletionRequestSchema = z.object({
  messages: z.array(messageSchema).min(1, "Messages array cannot be empty."),
  model: z.string(),
  frequency_penalty: z.number().min(-2).max(2).optional().nullable(),
  logit_bias: z.record(z.string(), z.number()).optional().nullable(),
  logprobs: z.boolean().optional().nullable(),
  top_logprobs: z.number().int().min(0).max(20).optional().nullable(),
  max_tokens: z.number().int().optional().nullable(),
  n: z.number().int().min(1).max(128).optional().nullable(),
  presence_penalty: z.number().min(-2).max(2).optional().nullable(),
  response_format: z
    .object({
      type: z.enum(["text", "json_object", "json_schema"]),
      json_schema: z.object({}).optional(),
    })
    .optional(),
  seed: z.number().int().optional().nullable(),
  stop: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .nullable(),
  stream: z.boolean().optional().nullable(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  top_p: z.number().min(0).max(1).optional().nullable(),
  tools: z.array(z.any()).optional(),
  tool_choice: z.union([z.string(), z.object({})]).optional(),
  user: z.string().optional(),
})

/**
 * Validates if a request payload conforms to the OpenAI Chat Completion v1 shape using Zod.
 * @param payload The request payload to validate.
 * @returns True if the payload is valid, false otherwise.
 */
function isValidChatCompletionRequest(payload: unknown): boolean {
  const result = chatCompletionRequestSchema.safeParse(payload)
  return result.success
}

function expectValidTranslatedPayload(payload: AnthropicMessagesPayload) {
  const openAIPayload = translateToOpenAI(payload)
  expect(isValidChatCompletionRequest(openAIPayload)).toBe(true)

  return openAIPayload
}

describe("Anthropic to OpenAI translation logic", () => {
  test("should translate minimal Anthropic payload to valid OpenAI payload", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      max_tokens: 0,
    }

    expectValidTranslatedPayload(anthropicPayload)
  })

  test("should translate comprehensive Anthropic payload to valid OpenAI payload", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "gpt-4o",
      system: "You are a helpful assistant.",
      messages: [
        { role: "user", content: "What is the weather like in Boston?" },
        {
          role: "assistant",
          content: "The weather in Boston is sunny and 75°F.",
        },
      ],
      temperature: 0.7,
      max_tokens: 150,
      top_p: 1,
      stream: false,
      metadata: { user_id: "user-123" },
      tools: [
        {
          name: "getWeather",
          description: "Gets weather info",
          input_schema: { location: { type: "string" } },
        },
      ],
      tool_choice: { type: "auto" },
    }
    expectValidTranslatedPayload(anthropicPayload)
  })

  test("should handle missing fields gracefully", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      max_tokens: 0,
    }
    expectValidTranslatedPayload(anthropicPayload)
  })

  test("should handle invalid types in Anthropic payload", () => {
    const anthropicPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      temperature: "hot", // Should be a number
    }
    // @ts-expect-error intended to be invalid
    const openAIPayload = translateToOpenAI(anthropicPayload)
    // Should fail validation
    expect(isValidChatCompletionRequest(openAIPayload)).toBe(false)
  })
})

describe("Anthropic thinking and tool translation", () => {
  test("should handle thinking blocks in assistant messages", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user", content: "What is 2+2?" },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Let me think about this simple math problem...",
            },
            { type: "text", text: "2+2 equals 4." },
          ],
        },
      ],
      max_tokens: 100,
    }
    const openAIPayload = expectValidTranslatedPayload(anthropicPayload)

    // Check that thinking content is combined with text content
    const assistantMessage = openAIPayload.messages.find(
      (m) => m.role === "assistant",
    )
    expect(assistantMessage?.content).toBe("2+2 equals 4.")
    expect(assistantMessage?.reasoning_text).toBe(
      "Let me think about this simple math problem...",
    )
    expect(assistantMessage?.reasoning_opaque).toBeUndefined()
    expect(assistantMessage?.content).toContain("2+2 equals 4.")
  })

  test("should map thinking signatures to Copilot reasoning_opaque fields", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user", content: "Solve this" },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Tracing the reasoning path.",
              signature: "sig_123",
            },
            { type: "text", text: "Here is the answer." },
          ],
        },
      ],
      max_tokens: 100,
    }

    const openAIPayload = expectValidTranslatedPayload(anthropicPayload)
    const assistantMessage = openAIPayload.messages.find(
      (message) => message.role === "assistant",
    )

    expect(assistantMessage?.reasoning_text).toBe("Tracing the reasoning path.")
    expect(assistantMessage?.reasoning_opaque).toBe("sig_123")
    expect(assistantMessage?.signature).toBeUndefined()
  })
})

describe("Anthropic thinking request metadata translation", () => {
  test("should request upstream reasoning summary and encrypted content when anthropic thinking is enabled", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Think carefully" }],
      max_tokens: 100,
      thinking: {
        type: "enabled",
        budget_tokens: 32,
      },
    }

    const openAIPayload = expectValidTranslatedPayload(anthropicPayload)

    expect(openAIPayload.reasoning).toEqual({
      summary: "detailed",
    })
    expect(openAIPayload.include).toEqual(["reasoning.encrypted_content"])
  })

  test("should not request upstream reasoning metadata when anthropic thinking is disabled", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Answer directly" }],
      max_tokens: 100,
    }

    const openAIPayload = expectValidTranslatedPayload(anthropicPayload)

    expect(openAIPayload.reasoning).toBeUndefined()
    expect(openAIPayload.include).toBeUndefined()
  })
})

describe("Anthropic tool translation", () => {
  test("should handle thinking blocks with tool calls", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user", content: "What's the weather?" },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking:
                "I need to call the weather API to get current weather information.",
            },
            { type: "text", text: "I'll check the weather for you." },
            {
              type: "tool_use",
              id: "call_123",
              name: "get_weather",
              input: { location: "New York" },
            },
          ],
        },
      ],
      max_tokens: 100,
    }
    const openAIPayload = expectValidTranslatedPayload(anthropicPayload)

    // Check that thinking content is included in the message content
    const assistantMessage = openAIPayload.messages.find(
      (m) => m.role === "assistant",
    )
    expect(assistantMessage?.reasoning_text).toContain(
      "I need to call the weather API",
    )
    expect(assistantMessage?.content).toContain(
      "I'll check the weather for you.",
    )
    expect(assistantMessage?.tool_calls).toHaveLength(1)
    expect(assistantMessage?.tool_calls?.[0].function.name).toBe("get_weather")
  })

  test("should translate tool_result content blocks into tool messages", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user", content: "Read this image" },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: [
                { type: "text", text: "found data" },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: "abc123",
                  },
                },
              ],
            },
          ],
        },
      ],
      max_tokens: 100,
    }

    const openAIPayload = expectValidTranslatedPayload(anthropicPayload)
    const toolMessage = openAIPayload.messages.find(
      (message) => message.role === "tool",
    )

    expect(toolMessage).toEqual({
      role: "tool",
      tool_call_id: "tool_1",
      content: [
        { type: "text", text: "found data" },
        {
          type: "image_url",
          image_url: {
            url: "data:image/png;base64,abc123",
          },
        },
      ],
    })
  })

  test("should convert document blocks into text placeholders for chat-completions fallback", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Summarize this attachment" },
            {
              type: "document",
              title: "report.pdf",
              context: "Quarterly revenue report",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: "JVBERi0xLjQK",
              },
            },
          ],
        },
      ],
      max_tokens: 100,
    }

    const openAIPayload = expectValidTranslatedPayload(anthropicPayload)
    expect(openAIPayload.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Summarize this attachment" },
        {
          type: "text",
          text: [
            "[Attached document omitted for chat-completions fallback: application/pdf]",
            "Details: report.pdf — Quarterly revenue report",
            "Approximate size: 9 bytes (base64 payload preserved only on upstream Claude messages API).",
          ].join("\n"),
        },
      ],
    })
  })

  test("should normalize anthropic tool schemas to Copilot tool parameter shape", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Use a tool" }],
      max_tokens: 100,
      tools: [
        {
          name: "search_docs",
          description: "Searches docs",
          input_schema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ],
    }

    const openAIPayload = expectValidTranslatedPayload(anthropicPayload)

    expect(openAIPayload.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search_docs",
          description: "Searches docs",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      },
    ])
  })

  test("should append a synthetic user continuation when translation ends on assistant", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user", content: "Start" },
        { role: "assistant", content: "Continuing draft" },
      ],
      max_tokens: 100,
    }

    const openAIPayload = expectValidTranslatedPayload(anthropicPayload)

    expect(openAIPayload.messages.at(-2)).toEqual({
      role: "assistant",
      content: "Continuing draft",
    })
    expect(openAIPayload.messages.at(-1)).toEqual({
      role: "user",
      content: "Please continue.",
    })
  })
})

describe("OpenAI Chat Completion v1 Request Payload Validation with Zod", () => {
  test("should return true for a minimal valid request payload", () => {
    const validPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
    }
    expect(isValidChatCompletionRequest(validPayload)).toBe(true)
  })

  test("should return true for a comprehensive valid request payload", () => {
    const validPayload = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is the weather like in Boston?" },
      ],
      temperature: 0.7,
      max_tokens: 150,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      stream: false,
      n: 1,
    }
    expect(isValidChatCompletionRequest(validPayload)).toBe(true)
  })

  test('should return false if the "model" field is missing', () => {
    const invalidPayload = {
      messages: [{ role: "user", content: "Hello!" }],
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if the "messages" field is missing', () => {
    const invalidPayload = {
      model: "gpt-4o",
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if the "messages" array is empty', () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: [],
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if "model" is not a string', () => {
    const invalidPayload = {
      model: 12345,
      messages: [{ role: "user", content: "Hello!" }],
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if "messages" is not an array', () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: { role: "user", content: "Hello!" },
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if a message in the "messages" array is missing a "role"', () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: [{ content: "Hello!" }],
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if a message in the "messages" array is missing "content"', () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: [{ role: "user" }],
    }
    // Note: Zod considers 'undefined' as missing, so this will fail as expected.
    const result = chatCompletionRequestSchema.safeParse(invalidPayload)
    expect(result.success).toBe(false)
  })

  test('should return false if a message has an invalid "role"', () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: [{ role: "customer", content: "Hello!" }],
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test("should return false if an optional field has an incorrect type", () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      temperature: "hot", // Should be a number
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test("should return false for a completely empty object", () => {
    const invalidPayload = {}
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test("should return false for null or non-object payloads", () => {
    expect(isValidChatCompletionRequest(null)).toBe(false)
    expect(isValidChatCompletionRequest(undefined)).toBe(false)
    expect(isValidChatCompletionRequest("a string")).toBe(false)
    expect(isValidChatCompletionRequest(123)).toBe(false)
  })
})
