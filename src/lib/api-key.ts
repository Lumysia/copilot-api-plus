import type { Context, Next } from "hono"

import consola from "consola"

import { state } from "~/lib/state"

function getBearerToken(
  authorizationHeader: string | undefined,
): string | undefined {
  if (!authorizationHeader) return undefined

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2)
  if (scheme.toLowerCase() !== "bearer" || !token) return undefined

  return token
}

function getForwardedIp(
  forwardedHeader: string | undefined,
): string | undefined {
  if (!forwardedHeader) return undefined

  const match = forwardedHeader.match(/for="?\[?([^;,"]+)/i)
  return match?.[1]?.trim()
}

function getClientAddress(c: Context): string {
  const candidates = [
    c.req.header("cf-connecting-ip"),
    c.req.header("x-real-ip"),
    c.req.header("x-client-ip"),
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim(),
    getForwardedIp(c.req.header("forwarded")),
    c.req.header("fly-client-ip"),
  ]

  return candidates.find((value) => value && value.length > 0) ?? "unknown"
}

function getRequestTarget(c: Context): string {
  try {
    const url = new URL(c.req.url)
    return `${c.req.method} ${url.pathname}`
  } catch {
    return `${c.req.method} unknown`
  }
}

function rejectUnauthorized() {
  return {
    error: {
      message: "Invalid API key",
      type: "authentication_error",
    },
  }
}

export async function safeRequestLogger(c: Context, next: Next) {
  const startedAt = Date.now()
  const target = getRequestTarget(c)

  consola.info(`<-- ${target}`)
  await next()
  consola.info(`--> ${target} ${c.res.status} ${Date.now() - startedAt}ms`)
}

export async function requireApiKey(c: Context, next: Next) {
  if (!state.apiKey) {
    await next()
    return
  }

  const clientAddress = getClientAddress(c)

  const authorization = c.req.header("authorization")
  const bearerToken = getBearerToken(authorization)
  const xApiKey = c.req.header("x-api-key")

  if (bearerToken === state.apiKey || xApiKey === state.apiKey) {
    consola.info(
      `Accepted API key request from ${clientAddress} to ${getRequestTarget(c)}`,
    )
    await next()
    return
  }

  consola.warn(
    `Rejected API key request from ${clientAddress} to ${getRequestTarget(c)}`,
  )

  return c.json(rejectUnauthorized(), 401)
}
