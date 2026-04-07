import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import consola from "consola"

import { buildPassthroughHeaders } from "~/lib/transport"

export class HTTPError extends Error {
  response: Response

  constructor(message: string, response: Response) {
    super(message)
    this.response = response
  }
}

function getJsonErrorBody(errorJson: unknown, fallbackText: string) {
  if (
    typeof errorJson === "object"
    && errorJson !== null
    && "error" in errorJson
    && typeof errorJson.error === "object"
    && errorJson.error !== null
  ) {
    return errorJson
  }

  return {
    error: {
      message: fallbackText,
      type: "error",
    },
  }
}

function isAnthropicRoute(c: Context): boolean {
  return (
    c.req.path === "/messages"
    || c.req.path === "/v1/messages"
    || c.req.path === "/messages/count_tokens"
    || c.req.path === "/v1/messages/count_tokens"
  )
}

function extractErrorMessage(errorJson: unknown, fallbackText: string): string {
  if (
    typeof errorJson === "object"
    && errorJson !== null
    && "error" in errorJson
    && typeof errorJson.error === "object"
    && errorJson.error !== null
    && "message" in errorJson.error
    && typeof errorJson.error.message === "string"
  ) {
    return errorJson.error.message
  }

  return fallbackText
}

function extractErrorType(errorJson: unknown): string {
  if (
    typeof errorJson === "object"
    && errorJson !== null
    && "error" in errorJson
    && typeof errorJson.error === "object"
    && errorJson.error !== null
    && "type" in errorJson.error
    && typeof errorJson.error.type === "string"
  ) {
    return errorJson.error.type
  }

  return "api_error"
}

function getAnthropicErrorBody(errorJson: unknown, fallbackText: string) {
  if (
    typeof errorJson === "object"
    && errorJson !== null
    && "type" in errorJson
    && errorJson.type === "error"
    && "error" in errorJson
    && typeof errorJson.error === "object"
    && errorJson.error !== null
  ) {
    return errorJson
  }

  if (
    typeof errorJson === "object"
    && errorJson !== null
    && "error" in errorJson
    && typeof errorJson.error === "object"
    && errorJson.error !== null
  ) {
    return {
      type: "error",
      error: {
        type: extractErrorType(errorJson),
        message: extractErrorMessage(errorJson, fallbackText),
      },
    }
  }

  return {
    type: "error",
    error: {
      type: "api_error",
      message: fallbackText,
    },
  }
}

export async function forwardError(c: Context, error: unknown) {
  consola.error("Error occurred:", error)
  const surface = isAnthropicRoute(c) ? "anthropic" : "openai"

  if (error instanceof HTTPError) {
    const errorText = await error.response.text()
    let errorJson: unknown
    try {
      errorJson = JSON.parse(errorText)
    } catch {
      errorJson = errorText
    }
    consola.error("HTTP error:", errorJson)

    return new Response(
      JSON.stringify(
        surface === "anthropic" ?
          getAnthropicErrorBody(errorJson, errorText)
        : getJsonErrorBody(errorJson, errorText),
      ),
      {
        status: error.response.status as ContentfulStatusCode,
        headers: buildPassthroughHeaders(error.response.headers, surface, {
          includeContentType: true,
        }),
      },
    )
  }

  return c.json(
    surface === "anthropic" ?
      {
        type: "error",
        error: {
          type: "api_error",
          message: (error as Error).message,
        },
      }
    : {
        error: {
          message: (error as Error).message,
          type: "error",
        },
      },
    500,
  )
}
