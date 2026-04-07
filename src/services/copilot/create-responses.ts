import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

type ResponsesInputMessageRole =
  | "user"
  | "assistant"
  | "system"
  | "developer"
  | "tool"

interface ResponsesInputMessage {
  role?: ResponsesInputMessageRole
  [key: string]: unknown
}

interface ResponsesReasoning {
  effort?: "low" | "medium" | "high" | "minimal" | null
  summary?: "auto" | "concise" | "detailed" | null
  [key: string]: unknown
}

export interface ResponsesPayload {
  stream?: boolean | null
  input?: unknown
  max_tokens?: number | null
  max_output_tokens?: number | null
  truncation?: "auto" | "disabled" | null
  include?: Array<string> | null
  store?: boolean | null
  reasoning?: ResponsesReasoning | null
  previous_response_id?: string | null
  [key: string]: unknown
}

const DEFAULT_RESPONSES_INCLUDE = "reasoning.encrypted_content"

function isInputMessage(value: unknown): value is ResponsesInputMessage {
  return typeof value === "object" && value !== null
}

function normalizeInput(input: unknown): unknown {
  if (!Array.isArray(input)) {
    return input
  }

  return input.map((item): unknown => {
    if (!isInputMessage(item) || item.role !== "developer") {
      return item
    }

    return {
      ...item,
      role: "system",
    }
  })
}

function getInitiator(input: unknown): "agent" | "user" {
  if (!Array.isArray(input)) {
    return "user"
  }

  return (
      input.some(
        (item) =>
          isInputMessage(item)
          && ["assistant", "tool"].includes(item.role ?? ""),
      )
    ) ?
      "agent"
    : "user"
}

function normalizeResponsesPayload(
  payload: ResponsesPayload,
): ResponsesPayload {
  const include = new Set(payload.include ?? [])
  include.add(DEFAULT_RESPONSES_INCLUDE)

  return {
    ...payload,
    input: normalizeInput(payload.input),
    max_output_tokens:
      payload.max_output_tokens ?? payload.max_tokens ?? undefined,
    store: payload.store ?? false,
    truncation: payload.truncation ?? "disabled",
    include: [...include],
  }
}

export const createResponses = async (payload: ResponsesPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const normalizedPayload = normalizeResponsesPayload(payload)
  const headers: Record<string, string> = {
    ...copilotHeaders(state),
    "X-Initiator": getInitiator(normalizedPayload.input),
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(normalizedPayload),
  })

  if (!response.ok) throw new HTTPError("Failed to create responses", response)

  return response
}
