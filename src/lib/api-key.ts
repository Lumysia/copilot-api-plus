import type { Context, Next } from "hono"

import consola from "consola"

import { state } from "~/lib/state"

const AUTH_WINDOW_MS = 5 * 60 * 1000
const AUTH_MAX_FAILURES = 10
const AUTH_BLOCK_MS = 15 * 60 * 1000

function getBearerToken(
  authorizationHeader: string | undefined,
): string | undefined {
  if (!authorizationHeader) return undefined

  const [scheme, token] = authorizationHeader.split(" ", 2)
  if (scheme !== "Bearer" || !token) return undefined

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

function isClientBlocked(clientAddress: string, now: number): boolean {
  const entry = state.authFailures.get(clientAddress)
  if (!entry?.blockedUntil) return false

  if (entry.blockedUntil <= now) {
    state.authFailures.delete(clientAddress)
    return false
  }

  return true
}

function recordAuthFailure(clientAddress: string, now: number): void {
  const entry = state.authFailures.get(clientAddress)

  if (!entry || entry.resetAt <= now) {
    state.authFailures.set(clientAddress, {
      blockedUntil: undefined,
      count: 1,
      resetAt: now + AUTH_WINDOW_MS,
    })
    return
  }

  entry.count += 1
  if (entry.count >= AUTH_MAX_FAILURES) {
    entry.blockedUntil = now + AUTH_BLOCK_MS
  }
}

function clearAuthFailures(clientAddress: string): void {
  state.authFailures.delete(clientAddress)
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

  const now = Date.now()
  const clientAddress = getClientAddress(c)

  if (isClientBlocked(clientAddress, now)) {
    consola.warn(
      `Blocked API key request from ${clientAddress} to ${getRequestTarget(c)}`,
    )
    return c.json(rejectUnauthorized(), 429)
  }

  const authorization = c.req.header("authorization")
  const bearerToken = getBearerToken(authorization)
  const xApiKey = c.req.header("x-api-key")

  if (bearerToken === state.apiKey || xApiKey === state.apiKey) {
    clearAuthFailures(clientAddress)
    await next()
    return
  }

  recordAuthFailure(clientAddress, now)
  consola.warn(
    `Rejected API key request from ${clientAddress} to ${getRequestTarget(c)}`,
  )

  return c.json(rejectUnauthorized(), 401)
}
