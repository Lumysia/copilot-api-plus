import consola from "consola"
import { events } from "fetch-event-stream"

import type { ChatCompletionResult } from "~/routes/chat-completions/types"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
): Promise<ChatCompletionResult> => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const { max_completion_tokens, max_tokens, stream_options, ...restPayload } =
    payload
  const hasMaxTokens = max_tokens !== null && max_tokens !== undefined
  const hasMaxCompletionTokens =
    max_completion_tokens !== null && max_completion_tokens !== undefined
  const normalizedStreamOptions =
    payload.stream ?
      {
        ...stream_options,
        include_usage: true,
      }
    : stream_options
  const usesMaxCompletionTokens = modelUsesMaxCompletionTokens(payload.model)
  const normalizedTokenPayload: Partial<ChatCompletionsPayload> = {}

  if (hasMaxTokens || hasMaxCompletionTokens) {
    if (usesMaxCompletionTokens) {
      normalizedTokenPayload.max_completion_tokens =
        max_completion_tokens ?? max_tokens
    } else {
      normalizedTokenPayload.max_tokens = max_tokens ?? max_completion_tokens
    }
  }

  const normalizedPayload: ChatCompletionsPayload = {
    ...restPayload,
    ...normalizedTokenPayload,
    ...(normalizedStreamOptions ?
      { stream_options: normalizedStreamOptions }
    : {}),
    messages: payload.messages.map((message) => ({
      ...message,
      role: message.role === "developer" ? "system" : message.role,
      content: normalizeMessageContent(message.content),
    })),
  }

  const enableVision = normalizedPayload.messages.some(
    (x) =>
      typeof x.content !== "string"
      && x.content?.some((x) => x.type === "image_url"),
  )

  // Agent/user check for X-Initiator header
  // Determine if any message is from an agent ("assistant" or "tool")
  const isAgentCall = normalizedPayload.messages.some((msg) =>
    ["assistant", "tool"].includes(msg.role),
  )

  // Build headers and add X-Initiator
  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  const response = await fetch(`${copilotBaseUrl(state)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(normalizedPayload),
  })

  if (!response.ok) {
    consola.error("Failed to create chat completions", response)
    throw new HTTPError("Failed to create chat completions", response)
  }

  if (normalizedPayload.stream) {
    return {
      headers: new Headers(response.headers),
      stream: (async function* () {
        for await (const event of events(response)) {
          if (typeof event.data !== "string") {
            continue
          }

          yield {
            data: event.data,
            event: event.event,
            id: typeof event.id === "undefined" ? undefined : String(event.id),
          }
        }
      })(),
    }
  }

  return {
    headers: new Headers(response.headers),
    body: (await response.json()) as ChatCompletionResponse,
  }
}

function normalizeMessageContent(
  content: Message["content"],
): Message["content"] {
  if (typeof content === "string") {
    return content.trimEnd()
  }

  if (!Array.isArray(content)) {
    return content
  }

  return content.map((part) => {
    if (part.type !== "text") {
      return part
    }

    return {
      ...part,
      text: part.text.trimEnd(),
    }
  })
}

function modelUsesMaxCompletionTokens(modelId: string): boolean {
  const model = state.models?.data.find((candidate) => candidate.id === modelId)
  const supports = model?.capabilities.supports

  return Boolean(
    supports?.thinking
      || supports?.reasoning_effort
      || supports?.adaptive_thinking
      || supports?.min_thinking_budget
      || supports?.max_thinking_budget,
  )
}

// Streaming types

export interface ChatCompletionChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<Choice>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
    completion_tokens_details?: {
      accepted_prediction_tokens: number
      rejected_prediction_tokens: number
    }
  }
}

export interface Delta {
  content?: string | null
  reasoning_opaque?: string
  reasoning_text?: string
  cot_id?: string
  cot_summary?: string
  thinking?: string
  signature?: string
  role?: "user" | "assistant" | "system" | "tool"
  tool_calls?: Array<{
    index: number
    id?: string
    type?: "function"
    function?: {
      name?: string
      arguments?: string
    }
  }>
}

interface Choice {
  index: number
  delta: Delta
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  logprobs: object | null
}

// Non-streaming types

export interface ChatCompletionResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<ChoiceNonStreaming>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
  }
}

export interface ResponseMessage {
  role: "assistant"
  content: string | null
  reasoning_opaque?: string
  reasoning_text?: string
  cot_id?: string
  cot_summary?: string
  thinking?: string
  signature?: string
  tool_calls?: Array<ToolCall>
}

interface ChoiceNonStreaming {
  index: number
  message: ResponseMessage
  logprobs: object | null
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
}

// Payload types

export interface ChatCompletionsPayload {
  messages: Array<Message>
  model: string
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  max_completion_tokens?: number | null
  stop?: string | Array<string> | null
  n?: number | null
  stream?: boolean | null
  stream_options?: {
    include_usage?: boolean
  } | null

  frequency_penalty?: number | null
  presence_penalty?: number | null
  logit_bias?: Record<string, number> | null
  logprobs?: boolean | null
  response_format?: { type: "json_object" } | null
  seed?: number | null
  tools?: Array<Tool> | null
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null
  include?: Array<string> | null
  reasoning?: {
    effort?: "low" | "medium" | "high" | "minimal" | null
    summary?: "auto" | "concise" | "detailed" | null
  } | null
  user?: string | null
}

export interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool" | "developer"
  content: string | Array<ContentPart> | null
  reasoning_opaque?: string
  reasoning_text?: string
  cot_id?: string
  cot_summary?: string
  thinking?: string
  signature?: string

  name?: string
  tool_calls?: Array<ToolCall>
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export type ContentPart = TextPart | ImagePart

export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image_url"
  image_url: {
    url: string
    detail?: "low" | "high" | "auto"
  }
}
