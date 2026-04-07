import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const createEmbeddings = async (payload: EmbeddingRequest) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const normalizedPayload = normalizeEmbeddingRequest(payload)

  const response = await fetch(`${copilotBaseUrl(state)}/embeddings`, {
    method: "POST",
    headers: copilotHeaders(state),
    body: JSON.stringify(normalizedPayload),
  })

  if (!response.ok) throw new HTTPError("Failed to create embeddings", response)

  const upstreamResponse = (await response.json()) as CopilotEmbeddingResponse
  return normalizeEmbeddingResponse(payload, upstreamResponse)
}

function normalizeEmbeddingRequest(
  payload: EmbeddingRequest,
): CopilotEmbeddingRequest {
  return {
    input: Array.isArray(payload.input) ? payload.input : [payload.input],
    model: payload.model,
    dimensions:
      payload.dimensions ?? getDefaultEmbeddingDimensions(payload.model),
  }
}

function normalizeEmbeddingResponse(
  request: EmbeddingRequest,
  response: CopilotEmbeddingResponse,
): EmbeddingResponse {
  const embeddings = response.data ?? response.embeddings ?? []

  return {
    object: "list",
    data: embeddings.map((item, index) => ({
      object: "embedding",
      embedding: item.embedding,
      index,
    })),
    model: response.model ?? request.model,
    usage: {
      prompt_tokens: response.usage?.prompt_tokens ?? 0,
      total_tokens: response.usage?.total_tokens ?? 0,
    },
  }
}

export interface EmbeddingRequest {
  input: string | Array<string>
  model: string
  dimensions?: number
}

interface CopilotEmbeddingRequest {
  input: Array<string>
  model: string
  dimensions?: number
}

interface CopilotEmbeddingItem {
  embedding: Array<number>
}

interface CopilotEmbeddingResponse {
  model?: string
  data?: Array<CopilotEmbeddingItem>
  embeddings?: Array<CopilotEmbeddingItem>
  usage?: {
    prompt_tokens?: number
    total_tokens?: number
  }
}

function getDefaultEmbeddingDimensions(model: string): number | undefined {
  switch (model) {
    case "text-embedding-3-small": {
      return 512
    }
    default: {
      return undefined
    }
  }
}

export interface Embedding {
  object: string
  embedding: Array<number>
  index: number
}

export interface EmbeddingResponse {
  object: string
  data: Array<Embedding>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}
