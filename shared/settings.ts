import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const settings = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Use the provider's reported output tokens for a finished turn's rate. */
    correctWithUsage: z.boolean().default(true),
  }),
});
