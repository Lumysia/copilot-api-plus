import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { getPublicModels } from "~/lib/models"
import { state } from "~/lib/state"
import { cacheModels } from "~/lib/utils"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    if (!state.models) {
      // This should be handled by startup logic, but as a fallback.
      await cacheModels()
    }

    return c.json({
      object: "list",
      data: getPublicModels(),
      has_more: false,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
