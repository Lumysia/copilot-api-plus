import type { ModelsResponse } from "~/services/copilot/get-models"

export interface State {
  githubToken?: string
  copilotToken?: string
  apiKey?: string

  accountType: string
  models?: ModelsResponse
  vsCodeVersion?: string

  manualApprove: boolean
  rateLimitWait: boolean
  showToken: boolean

  // Rate limiting configuration
  rateLimitSeconds?: number
  lastRequestTimestamp?: number

  authFailures: Map<
    string,
    { count: number; resetAt: number; blockedUntil?: number }
  >
}

export const state: State = {
  accountType: "individual",
  authFailures: new Map(),
  manualApprove: false,
  rateLimitWait: false,
  showToken: false,
}
