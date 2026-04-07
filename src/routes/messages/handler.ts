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
import { createMessages } from "~/services/copilot/create-messages"

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

  const resolvedModel = resolveModel(anthropicPayload.model)
  anthropicPayload.model = resolvedModel.resolvedModel

  if (state.manualApprove) {
    await awaitApproval()
  }

  if (shouldUseMessagesApi(resolvedModel)) {
    return await handleMessagesApiRequest(c, anthropicPayload)
  }

  const openAIPayload = translateToOpenAI(anthropicPayload)
  openAIPayload.model = resolvedModel.resolvedModel
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

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

function shouldUseMessagesApi(
  resolvedModel: ReturnType<typeof resolveModel>,
): boolean {
  const model = resolvedModel.canonicalModel
  const identifiers = [
    resolvedModel.requestedModel,
    resolvedModel.resolvedModel,
    model?.id,
    model?.name,
    model?.capabilities.family,
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase())

  return identifiers.some((value) => value.includes("claude"))
}

async function handleMessagesApiRequest(
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
) {
  const response = await createMessages(anthropicPayload)

  if ("body" in response) {
    return new Response(response.body.body, {
      status: 200,
      headers: buildPassthroughHeaders(response.headers, "anthropic", {
        includeContentType: true,
      }),
    })
  }

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
    for await (const event of response.stream) {
      await stream.writeSSE({
        event: event.event,
        data: event.data,
        id: event.id,
      })
    }
  })
}
