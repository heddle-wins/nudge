import type { ExecutionRequest, ExecutionResult } from "@nudge/contracts";

/**
 * The final browser-side guard. This function is intentionally self-contained:
 * background can inject it into tabs that existed before Nudge was installed.
 * It accepts a structured action, never a selector, script, URL, or value.
 */
export function executeApprovedAction(request: ExecutionRequest): ExecutionResult {
  const highImpactText = /\b(?:delete|remove|destroy|erase|submit|send|pay|payment|purchase|buy|transfer|withdraw|donate|order|book|sign\s*out|close\s+account|security|password|credential|permission|authorize|approve)\b/i;
  function result(status: ExecutionResult["status"], outcome: ExecutionResult["outcome"], message: string): ExecutionResult {
    return { status, outcome, message };
  }

  function isVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
  }

  function roleFor(element: HTMLElement): string {
    const explicitRole = element.getAttribute("role");
    if (explicitRole === "button" || element instanceof HTMLButtonElement) return "button";
    if (explicitRole === "link" || element instanceof HTMLAnchorElement) return "link";
    if (element instanceof HTMLSelectElement || explicitRole === "combobox") return "combobox";
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox") return "checkbox";
      if (element.type === "radio") return "radio";
      return "textbox";
    }
    if (element instanceof HTMLTextAreaElement) return "textbox";
    return "unknown";
  }

  function accessibleName(element: HTMLElement): string {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" ");
      if (label) return label;
    }
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return element.labels?.[0]?.textContent?.trim() || (element instanceof HTMLSelectElement ? "" : element.placeholder) || element.name || element.id || "Unlabelled field";
    }
    return element.textContent?.trim().slice(0, 500) || element.getAttribute("title") || "Unlabelled element";
  }

  function mfaOrCaptchaPresent(): boolean {
    const text = (document.body?.innerText || document.body?.textContent || "").slice(0, 50_000);
    return /\b(?:captcha|recaptcha|hcaptcha|one[ -]?time\s+(?:password|code)|otp|two[ -]?factor|multi[ -]?factor|authentication\s+code)\b/i.test(text)
      || Boolean(document.querySelector("iframe[src*='captcha' i], [class*='captcha' i], [id*='captcha' i]"));
  }

  if (window.location.origin !== request.expectedPageOrigin) {
    return result("blocked", "page_changed", "The page origin changed after the proposal. Inspect again before continuing.");
  }
  if (mfaOrCaptchaPresent()) {
    return result("blocked", "mfa_or_captcha", "Nudge paused because this page contains MFA or CAPTCHA verification. Continue directly in the page.");
  }
  if (request.action.type === "report_result") {
    return result("completed", "user_message", "Nudge recorded the result locally. No browser action was needed.");
  }
  if (request.action.type === "scroll") {
    window.scrollBy({ top: request.action.direction === "up" ? -Math.max(240, window.innerHeight * 0.7) : Math.max(240, window.innerHeight * 0.7), behavior: "smooth" });
    return result("completed", "action_completed", "Nudge scrolled the page after your confirmation.");
  }
  if (request.action.type !== "click" && request.action.type !== "select") {
    return result("blocked", "unsupported_action", "Nudge does not execute this action type. Continue directly in the page.");
  }

  const selectors = "button, a[href], input, textarea, select, [role='button'], [role='link'], [role='combobox'], h1, h2, h3";
  const candidates = [...document.querySelectorAll<HTMLElement>(selectors)].filter(isVisible);
  const index = Number.parseInt((request.action.targetId ?? "").replace(/^el_/, ""), 36) - 1;
  const target = candidates[index];
  if (!target || !request.expectedTarget || (target as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled || !isVisible(target)) {
    return result("blocked", "stale_target", "The proposed control is no longer available. Inspect again before continuing.");
  }
  if (roleFor(target) !== request.expectedTarget.role || accessibleName(target) !== request.expectedTarget.name) {
    return result("blocked", "stale_target", "The proposed control changed after the proposal. Inspect again before continuing.");
  }

  if (request.action.type === "click") {
    if (!(target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement || target.getAttribute("role") === "button" || target.getAttribute("role") === "link")) {
      return result("blocked", "unsupported_action", "Nudge only clicks a visible button or link after confirmation.");
    }
    if (target instanceof HTMLButtonElement && target.type === "submit" && Boolean(target.form)) {
      return result("blocked", "high_impact_action", "Nudge will not submit a form. Review and submit it directly in the page.");
    }
    if (highImpactText.test(accessibleName(target))) {
      return result("blocked", "high_impact_action", "Nudge will not complete a high-impact action. Continue directly in the page.");
    }
    if (target instanceof HTMLAnchorElement) {
      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin || target.target === "_blank") {
        return result("blocked", "external_navigation", "Nudge will not open an external or new-tab destination. Continue directly if you trust it.");
      }
    }
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.click();
    return result("completed", "action_completed", "Nudge completed the confirmed click.");
  }

  if (!(target instanceof HTMLSelectElement) || !request.action.optionLabel) {
    return result("blocked", "unsupported_action", "Nudge can only select a visible option in a standard select control.");
  }
  const option = [...target.options].find((item) => item.textContent?.trim() === request.action.optionLabel && !item.disabled);
  if (!option) return result("blocked", "stale_target", "That option is no longer available. Inspect again before continuing.");
  if (highImpactText.test(option.textContent ?? "")) {
    return result("blocked", "high_impact_action", "Nudge will not select a high-impact option. Continue directly in the page.");
  }
  target.value = option.value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  return result("completed", "action_completed", "Nudge selected the confirmed option.");
}
