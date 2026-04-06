import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import {
  createResponses,
  type ResponsesPayload,
} from "~/services/copilot/create-responses"

export const responsesRoutes = new Hono()

responsesRoutes.post("/", async (c) => {
  try {
    const payload = await c.req.json<ResponsesPayload>()
    const response = await createResponses(payload)

    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
