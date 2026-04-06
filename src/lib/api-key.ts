import type { Context, Next } from "hono"

import { state } from "~/lib/state"

function getBearerToken(
  authorizationHeader: string | undefined,
): string | undefined {
  if (!authorizationHeader) return undefined

  const [scheme, token] = authorizationHeader.split(" ", 2)
  if (scheme !== "Bearer" || !token) return undefined

  return token
}

export async function requireApiKey(c: Context, next: Next) {
  if (!state.apiKey) {
    await next()
    return
  }

  const authorization = c.req.header("authorization")
  const bearerToken = getBearerToken(authorization)
  const xApiKey = c.req.header("x-api-key")

  if (bearerToken === state.apiKey || xApiKey === state.apiKey) {
    await next()
    return
  }

  return c.json(
    {
      error: {
        message: "Invalid API key",
        type: "authentication_error",
      },
    },
    401,
  )
}
