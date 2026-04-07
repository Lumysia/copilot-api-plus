import type { SSEMessage } from "hono/streaming"

import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

export interface ChatCompletionJsonResult {
  headers: Headers
  body: ChatCompletionResponse
}

export interface ChatCompletionStreamResult {
  headers: Headers
  stream: AsyncIterable<SSEMessage>
}

export type ChatCompletionResult =
  | ChatCompletionJsonResult
  | ChatCompletionStreamResult
