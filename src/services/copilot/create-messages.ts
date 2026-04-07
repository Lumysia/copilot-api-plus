import type { SSEMessage } from "hono/streaming"

import { events } from "fetch-event-stream"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export type CopilotMessagesResult =
  | {
      headers: Headers
      body: Response
    }
  | {
      headers: Headers
      stream: AsyncIterable<SSEMessage>
    }

export const createMessages = async (
  payload: AnthropicMessagesPayload,
): Promise<CopilotMessagesResult> => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers = buildMessagesHeaders(payload)
  const response = await fetch(`${copilotBaseUrl(state)}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new HTTPError("Failed to create messages", response)
  }

  if (payload.stream) {
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
    body: response,
  }
}

function buildMessagesHeaders(
  payload: AnthropicMessagesPayload,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...copilotHeaders(state),
    accept: payload.stream ? "text/event-stream" : "application/json",
    "X-Initiator":
      payload.messages.some((message) => message.role === "assistant") ?
        "agent"
      : "user",
  }

  const betaHeaders = new Set<string>()
  if (payload.thinking?.type === "enabled") {
    betaHeaders.add("interleaved-thinking-2025-05-14")
  }

  if (betaHeaders.size > 0) {
    headers["anthropic-beta"] = [...betaHeaders].join(",")
  }

  return headers
}
