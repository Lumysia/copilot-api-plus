import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { resolveModel } from "~/lib/models"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { buildPassthroughHeaders } from "~/lib/transport"
import {
  createChatCompletions,
  type ChatCompletionChunk,
} from "~/services/copilot/create-chat-completions"

import type { ChatCompletionResult } from "../chat-completions/types"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  const openAIPayload = translateToOpenAI(anthropicPayload)
  const resolvedModel = resolveModel(openAIPayload.model)
  openAIPayload.model = resolvedModel.resolvedModel
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response.body).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response.body)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return new Response(JSON.stringify(anthropicResponse), {
      status: 200,
      headers: buildPassthroughHeaders(response.headers, "anthropic", {
        includeContentType: true,
      }),
    })
  }

  consola.debug("Streaming response from Copilot")
  const responseHeaders = buildPassthroughHeaders(
    response.headers,
    "anthropic",
    {
      streaming: true,
    },
  )
  for (const [key, value] of responseHeaders.entries()) {
    c.header(key, value)
  }

  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      currentContentBlockType: undefined,
      toolCalls: {},
    }

    for await (const rawEvent of response.stream) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }
  })
}

const isNonStreaming = (
  response: ChatCompletionResult,
): response is Extract<ChatCompletionResult, { body: unknown }> =>
  Object.hasOwn(response, "body")
