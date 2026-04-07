import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { normalizeResolvedModel } from "~/lib/models"
import { buildPassthroughHeaders } from "~/lib/transport"
import {
  createResponses,
  type ResponsesPayload,
} from "~/services/copilot/create-responses"

export const responsesRoutes = new Hono()

responsesRoutes.post("/", async (c) => {
  try {
    const payload = normalizeResolvedModel(
      await c.req.json<ResponsesPayload & { model: string }>(),
    )
    const response = await createResponses(payload)

    return new Response(response.body, {
      status: response.status,
      headers: buildPassthroughHeaders(response.headers, "openai", {
        includeContentType: true,
      }),
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
