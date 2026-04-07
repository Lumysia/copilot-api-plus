import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { resolveModel } from "~/lib/models"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { buildPassthroughHeaders } from "~/lib/transport"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

import type { ChatCompletionResult } from "./types"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()
  if (
    isNullish(payload.max_tokens)
    && !isNullish(payload.max_completion_tokens)
  ) {
    payload = {
      ...payload,
      max_tokens: payload.max_completion_tokens,
    }
  }
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  const resolvedModel = resolveModel(payload.model)
  payload = {
    ...payload,
    model: resolvedModel.resolvedModel,
  }
  const selectedModel = state.models?.data.find(
    (model) => model.id === resolvedModel.resolvedModel,
  )

  // Calculate and display token count
  try {
    if (selectedModel) {
      const tokenCount = await getTokenCount(payload, selectedModel)
      consola.info("Current token count:", tokenCount)
    } else {
      consola.warn("No model selected, skipping token count calculation")
    }
  } catch (error) {
    consola.warn("Failed to calculate token count:", error)
  }

  if (state.manualApprove) await awaitApproval()

  if (isNullish(payload.max_tokens)) {
    payload = {
      ...payload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug("Set max_tokens to:", JSON.stringify(payload.max_tokens))
  }

  const response = await createChatCompletions(payload)

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response.body))
    return new Response(JSON.stringify(response.body), {
      status: 200,
      headers: buildPassthroughHeaders(response.headers, "openai", {
        includeContentType: true,
      }),
    })
  }

  consola.debug("Streaming response")
  const responseHeaders = buildPassthroughHeaders(response.headers, "openai", {
    streaming: true,
  })
  for (const [key, value] of responseHeaders.entries()) {
    c.header(key, value)
  }

  return streamSSE(c, async (stream) => {
    let sawDone = false

    for await (const chunk of response.stream) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))
      if (chunk.data === "[DONE]") {
        sawDone = true
      }
      await stream.writeSSE(chunk)
    }

    if (!sawDone) {
      await stream.writeSSE({ data: "[DONE]" })
    }
  })
}

const isNonStreaming = (
  response: ChatCompletionResult,
): response is Extract<ChatCompletionResult, { body: unknown }> =>
  Object.hasOwn(response, "body")
