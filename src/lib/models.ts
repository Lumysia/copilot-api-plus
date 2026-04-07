import type { Model, ModelsResponse } from "~/services/copilot/get-models"

import { state } from "~/lib/state"

const MODEL_CREATED = 0
const MODEL_CREATED_AT = new Date(MODEL_CREATED).toISOString()

export interface ResolvedModel {
  requestedModel: string
  resolvedModel: string
  canonicalModel?: Model
}

interface PublicModelEntry {
  id: string
  object: "model"
  type: string
  created: number
  created_at: string
  owned_by: string
  display_name: string
  root: string
  parent: string | null
  canonical_model_id: string
  capabilities: Model["capabilities"] & {
    supports: Model["capabilities"]["supports"] & {
      streaming: boolean
      vision: boolean
      reasoning?: boolean
    }
  }
}

function supportsReasoning(model: Model): boolean {
  const candidates = [model.id, model.name, model.capabilities.family].map(
    (value) => value.toLowerCase(),
  )

  return candidates.some(
    (value) =>
      value.includes("reasoning")
      || /^o\d/.test(value)
      || value.includes("claude")
      || value.includes("gpt-4.1"),
  )
}

function getModelsResponse(): ModelsResponse {
  if (!state.models) {
    throw new Error("Models are not cached")
  }

  return state.models
}

function normalizeModelName(value: string): string {
  return value.trim().toLowerCase()
}

function buildClaudeAliases(model: Model): Array<string> {
  const aliases = new Set<string>([model.id])
  const normalizedName = normalizeModelName(model.name)
  const family = normalizeModelName(model.capabilities.family)

  if (family.startsWith("claude")) {
    aliases.add(family)
  }

  if (normalizedName.startsWith("claude ")) {
    aliases.add(normalizedName.replaceAll(/\s+/g, "-"))
  }

  const version = model.version.trim()
  if (family.startsWith("claude") && version) {
    const compactVersion = version.replaceAll("-", "")
    aliases.add(`${family}-${compactVersion}`)
  }

  return [...aliases]
}

function getModelAliases(model: Model): Array<string> {
  if (normalizeModelName(model.id).startsWith("claude")) {
    return buildClaudeAliases(model)
  }

  return [model.id]
}

export function resolveModel(modelId: string): ResolvedModel {
  const normalized = normalizeModelName(modelId)
  const models = getModelsResponse().data

  for (const model of models) {
    const aliases = getModelAliases(model)
    const matchedAlias = aliases.find(
      (alias) => normalizeModelName(alias) === normalized,
    )

    if (matchedAlias) {
      return {
        requestedModel: modelId,
        resolvedModel: model.id,
        canonicalModel: model,
      }
    }
  }

  return {
    requestedModel: modelId,
    resolvedModel: modelId,
    canonicalModel: undefined as never,
  }
}

export function getPublicModels(): Array<PublicModelEntry> {
  const models = getModelsResponse().data
  const publicModels = new Map<string, PublicModelEntry>()

  for (const model of models) {
    const aliases = getModelAliases(model)

    for (const alias of aliases) {
      publicModels.set(alias, {
        id: alias,
        object: "model",
        type: model.capabilities.type,
        created: MODEL_CREATED,
        created_at: MODEL_CREATED_AT,
        owned_by: model.vendor,
        display_name: model.name,
        root: model.id,
        parent: null,
        canonical_model_id: model.id,
        capabilities: {
          ...model.capabilities,
          supports: {
            ...model.capabilities.supports,
            streaming: true,
            vision: Boolean(model.capabilities.supports.vision),
            reasoning: supportsReasoning(model),
          },
        },
      })
    }
  }

  return [...publicModels.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}

export function normalizeResolvedModel<T extends { model: string }>(
  payload: T,
): T & { model: string } {
  const resolved = resolveModel(payload.model)
  return {
    ...payload,
    model: resolved.resolvedModel,
  }
}
