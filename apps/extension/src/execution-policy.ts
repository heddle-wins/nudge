import type { ExecutionRequest, SanitizedPageContext } from "@nudge/contracts";

export type ExecutionDecision =
  | { allowed: true }
  | { allowed: false; outcome: "high_impact_action" | "sensitive_target" | "unsupported_action"; message: string };

const HIGH_IMPACT_WORDS = /\b(?:delete|remove|destroy|erase|submit|send|pay|payment|purchase|buy|transfer|withdraw|donate|order|book|sign\s*out|close\s+account|security|password|credential|permission|authorize|approve)\b/i;
const SENSITIVE_WORDS = /\b(?:password|passcode|otp|one[ -]?time|verification|verify|aadhaar|pan\b|account\s*(?:number|details)|card\s*(?:number|details)|cvv|email|phone)\b/i;

/** The model may suggest; this local policy decides whether Nudge may execute. */
export function evaluateExecutionPolicy(request: ExecutionRequest, context: SanitizedPageContext): ExecutionDecision {
  const { action } = request;

  if (action.type === "report_result") return { allowed: true };
  if (action.type !== "click" && action.type !== "scroll" && action.type !== "select" && action.type !== "type") {
    return { allowed: false, outcome: "unsupported_action", message: "Nudge does not execute this action type. Continue directly in the page." };
  }

  if (action.type === "scroll") return { allowed: true };
  const target = context.page.elements.find((element) => element.id === action.targetId);
  if (!target) return { allowed: false, outcome: "unsupported_action", message: "The proposed target is no longer part of this inspected page." };

  const targetDescription = `${target.name} ${target.text ?? ""}`;
  if (SENSITIVE_WORDS.test(targetDescription)) {
    return { allowed: false, outcome: "sensitive_target", message: "Nudge will not operate an authentication, credential, or personal-data control." };
  }
  if (HIGH_IMPACT_WORDS.test(targetDescription)) {
    return { allowed: false, outcome: "high_impact_action", message: "This appears to be a high-impact action. Complete it directly in the page." };
  }
  if (action.type === "type") {
    if (!request.localValue?.trim()) {
      return { allowed: false, outcome: "unsupported_action", message: "Enter the exact text locally before Nudge can fill this field." };
    }
    if (target.role !== "textbox" && target.role !== "combobox") {
      return { allowed: false, outcome: "unsupported_action", message: "Nudge can only type into a verified text field." };
    }
  }
  return { allowed: true };
}
