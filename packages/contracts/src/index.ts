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

export const actionTypeSchema = z.enum([
  "click",
  "scroll",
  "select",
  "type",
  "navigate",
  "request_user_input",
  "report_result"
]);

export type ActionType = z.infer<typeof actionTypeSchema>;

export const proposedActionSchema = z.object({
  type: actionTypeSchema,
  targetId: z.string().regex(/^el_[A-Za-z0-9_-]{1,120}$/).optional(),
  direction: z.enum(["up", "down"]).optional(),
  optionLabel: z.string().max(300).optional(),
  message: z.string().max(1_000).optional()
}).strict();

export type ProposedAction = z.infer<typeof proposedActionSchema>;

export const nextActionRequestSchema = z.object({
  task: z.string().trim().min(1).max(1_000),
  context: sanitizedPageContextSchema
}).strict();

export type NextActionRequest = z.infer<typeof nextActionRequestSchema>;

export const nextActionResponseSchema = z.object({
  schemaVersion: z.literal("1.0"),
  action: proposedActionSchema,
  rationale: z.string().min(1).max(1_000),
  confidence: z.number().min(0).max(1),
  requiresConfirmation: z.boolean()
}).strict();

export type NextActionResponse = z.infer<typeof nextActionResponseSchema>;
