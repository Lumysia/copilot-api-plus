import { type ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import {
  type AnthropicStreamEventData,
  type AnthropicStreamState,
} from "./anthropic-types"
import { mapOpenAIStopReasonToAnthropic } from "./utils"

function getThinkingText(
  thinking: ChatCompletionChunk["choices"][number]["delta"],
): string | undefined {
  if (thinking.cot_summary) {
    return thinking.cot_summary
  }
  if (thinking.reasoning_text) {
    return thinking.reasoning_text
  }
  if (thinking.thinking) {
    return thinking.thinking
  }
  return undefined
}

function getThinkingId(
  thinking: ChatCompletionChunk["choices"][number]["delta"],
): string | undefined {
  if (thinking.cot_id) {
    return thinking.cot_id
  }
  if (thinking.reasoning_opaque) {
    return thinking.reasoning_opaque
  }
  if (thinking.signature) {
    return thinking.signature
  }
  return undefined
}

function closeCurrentContentBlock(
  events: Array<AnthropicStreamEventData>,
  state: AnthropicStreamState,
): void {
  if (!state.contentBlockOpen) {
    return
  }

  events.push({
    type: "content_block_stop",
    index: state.contentBlockIndex,
  })
  state.contentBlockIndex++
  state.contentBlockOpen = false
  state.currentContentBlockType = undefined
}

function ensureContentBlock(
  events: Array<AnthropicStreamEventData>,
  state: AnthropicStreamState,
  block:
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string; signature?: string }
    | {
        type: "tool_use"
        id: string
        name: string
        input: Record<string, unknown>
      },
): void {
  if (state.contentBlockOpen && state.currentContentBlockType !== block.type) {
    closeCurrentContentBlock(events, state)
  }

  if (!state.contentBlockOpen) {
    events.push({
      type: "content_block_start",
      index: state.contentBlockIndex,
      content_block: block,
    })
    state.contentBlockOpen = true
    state.currentContentBlockType = block.type
  }
}

// eslint-disable-next-line max-lines-per-function, complexity
export function translateChunkToAnthropicEvents(
  chunk: ChatCompletionChunk,
  state: AnthropicStreamState,
): Array<AnthropicStreamEventData> {
  const events: Array<AnthropicStreamEventData> = []

  if (chunk.choices.length === 0) {
    return events
  }

  const choice = chunk.choices[0]
  const { delta } = choice
  const thinkingText = getThinkingText(delta)
  const thinkingId = getThinkingId(delta)

  if (!state.messageStartSent) {
    events.push({
      type: "message_start",
      message: {
        id: chunk.id,
        type: "message",
        role: "assistant",
        content: [],
        model: chunk.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens:
            (chunk.usage?.prompt_tokens ?? 0)
            - (chunk.usage?.prompt_tokens_details?.cached_tokens ?? 0),
          output_tokens: 0, // Will be updated in message_delta when finished
          ...(chunk.usage?.prompt_tokens_details?.cached_tokens
            !== undefined && {
            cache_read_input_tokens:
              chunk.usage.prompt_tokens_details.cached_tokens,
          }),
        },
      },
    })
    state.messageStartSent = true
  }

  if (thinkingText || thinkingId) {
    ensureContentBlock(events, state, {
      type: "thinking",
      thinking: thinkingText ?? "",
      ...(thinkingId ? { signature: thinkingId } : {}),
    })

    if (thinkingText) {
      events.push({
        type: "content_block_delta",
        index: state.contentBlockIndex,
        delta: {
          type: "thinking_delta",
          thinking: thinkingText,
        },
      })
    }

    if (thinkingId) {
      events.push({
        type: "content_block_delta",
        index: state.contentBlockIndex,
        delta: {
          type: "signature_delta",
          signature: thinkingId,
        },
      })
    }
  }

  if (delta.content) {
    ensureContentBlock(events, state, {
      type: "text",
      text: "",
    })

    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: {
        type: "text_delta",
        text: delta.content,
      },
    })
  }

  if (delta.tool_calls) {
    for (const toolCall of delta.tool_calls) {
      if (toolCall.id && toolCall.function?.name) {
        if (state.contentBlockOpen) {
          closeCurrentContentBlock(events, state)
        }

        const anthropicBlockIndex = state.contentBlockIndex
        state.toolCalls[toolCall.index] = {
          id: toolCall.id,
          name: toolCall.function.name,
          anthropicBlockIndex,
        }

        ensureContentBlock(events, state, {
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: {},
        })
      }

      if (toolCall.function?.arguments) {
        const toolCallInfo = state.toolCalls[toolCall.index]
        // Tool call can still be empty
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (toolCallInfo) {
          events.push({
            type: "content_block_delta",
            index: toolCallInfo.anthropicBlockIndex,
            delta: {
              type: "input_json_delta",
              partial_json: toolCall.function.arguments,
            },
          })
        }
      }
    }
  }

  if (choice.finish_reason) {
    closeCurrentContentBlock(events, state)

    events.push(
      {
        type: "message_delta",
        delta: {
          stop_reason: mapOpenAIStopReasonToAnthropic(choice.finish_reason),
          stop_sequence: null,
        },
        usage: {
          input_tokens:
            (chunk.usage?.prompt_tokens ?? 0)
            - (chunk.usage?.prompt_tokens_details?.cached_tokens ?? 0),
          output_tokens: chunk.usage?.completion_tokens ?? 0,
          ...(chunk.usage?.prompt_tokens_details?.cached_tokens
            !== undefined && {
            cache_read_input_tokens:
              chunk.usage.prompt_tokens_details.cached_tokens,
          }),
        },
      },
      {
        type: "message_stop",
      },
    )
  }

  return events
}

export function translateErrorToAnthropicErrorEvent(): AnthropicStreamEventData {
  return {
    type: "error",
    error: {
      type: "api_error",
      message: "An unexpected error occurred during streaming.",
    },
  }
}
