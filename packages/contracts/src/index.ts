import { z } from "zod";

export const piiKindSchema = z.enum([
  "password",
  "email",
  "phone",
  "government_id",
  "payment",
  "account_number",
  "address",
  "date_of_birth",
  "token",
  "user_marked"
]);

export type PiiKind = z.infer<typeof piiKindSchema>;

export const elementRoleSchema = z.enum([
  "button",
  "link",
  "textbox",
  "combobox",
  "checkbox",
  "radio",
  "select",
  "heading",
  "text",
  "unknown"
]);

export const sanitizedElementSchema = z.object({
  id: z.string(),
  role: elementRoleSchema,
  name: z.string().max(500),
  text: z.string().max(2_000).optional(),
  value: z.string().max(500).optional(),
  state: z.object({
    enabled: z.boolean(),
    visible: z.boolean(),
    required: z.boolean().optional()
  })
});

export type SanitizedElement = z.infer<typeof sanitizedElementSchema>;

export const sanitizedPageContextSchema = z.object({
  schemaVersion: z.literal("1.0"),
  source: z.literal("nudge-extension"),
  page: z.object({
    urlOrigin: z.string().url(),
    title: z.string().max(500),
    elements: z.array(sanitizedElementSchema),
    redactions: z.object({
      count: z.number().int().nonnegative(),
      types: z.array(piiKindSchema)
    })
  })
});

export type SanitizedPageContext = z.infer<typeof sanitizedPageContextSchema>;
