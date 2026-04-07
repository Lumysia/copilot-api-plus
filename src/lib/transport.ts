const requestIdHeaders = [
  "x-request-id",
  "request-id",
  "anthropic-request-id",
] as const

const passthroughResponseHeaders = [
  ...requestIdHeaders,
  "x-github-request-id",
  "openai-processing-ms",
  "anthropic-processing-ms",
  "retry-after",
] as const

export type TransportSurface = "openai" | "anthropic"

export function getRequestId(headers: Headers): string | null {
  for (const headerName of requestIdHeaders) {
    const headerValue = headers.get(headerName)
    if (headerValue) {
      return headerValue
    }
  }

  return null
}

export function buildPassthroughHeaders(
  source: Headers,
  surface: TransportSurface,
  options?: {
    includeContentType?: boolean
    streaming?: boolean
  },
): Headers {
  const headers = new Headers()

  for (const headerName of passthroughResponseHeaders) {
    const headerValue = source.get(headerName)
    if (headerValue) {
      headers.set(headerName, headerValue)
    }
  }

  if (options?.includeContentType) {
    const contentType = source.get("content-type")
    if (contentType) {
      headers.set("content-type", contentType)
    }
  }

  const requestId = getRequestId(source)
  if (requestId) {
    if (surface === "anthropic") {
      headers.set("request-id", requestId)
      headers.set("anthropic-request-id", requestId)
    } else {
      headers.set("x-request-id", requestId)
      headers.set("request-id", requestId)
    }
  }

  if (options?.streaming) {
    headers.set("content-type", "text/event-stream")
    headers.set("cache-control", "no-cache")
  }

  return headers
}
