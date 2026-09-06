import type { PiiKind, SanitizedElement, SanitizedPageContext } from "@nudge/contracts";

export type RawPageElement = {
  id: string;
  role: SanitizedElement["role"];
  name: string;
  text?: string;
  value?: string;
  inputType?: string;
  autocomplete?: string;
  state: SanitizedElement["state"];
};

export type RawPageContext = {
  url: string;
  title: string;
  elements: RawPageElement[];
};

export type SanitizationResult = {
  value: string;
  redactions: PiiKind[];
};

const placeholder: Record<PiiKind, string> = {
  password: "[PASSWORD_REDACTED]",
  email: "[EMAIL_REDACTED]",
  phone: "[PHONE_REDACTED]",
  government_id: "[ID_REDACTED]",
  payment: "[PAYMENT_REDACTED]",
  account_number: "[ACCOUNT_REDACTED]",
  address: "[ADDRESS_REDACTED]",
  date_of_birth: "[DOB_REDACTED]",
  token: "[TOKEN_REDACTED]"
};

const semanticRules: Array<{ kind: PiiKind; pattern: RegExp }> = [
  { kind: "password", pattern: /password|passcode|pin\b/i },
  { kind: "email", pattern: /e-?mail/i },
  { kind: "phone", pattern: /phone|mobile|telephone|contact number/i },
  { kind: "government_id", pattern: /aadhaar|aadhar|pan\b|passport|government id|national id/i },
  { kind: "payment", pattern: /card number|cvv|credit card|debit card|upi/i },
  { kind: "account_number", pattern: /account number|bank account|ifsc/i },
  { kind: "address", pattern: /address|street|postal|pincode|zip code/i },
  { kind: "date_of_birth", pattern: /date of birth|birth date|\bdob\b/i },
  { kind: "token", pattern: /api key|access token|authorization|secret/i }
];

const inlineRules: Array<{ kind: PiiKind; pattern: RegExp }> = [
  { kind: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: "phone", pattern: /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g },
  { kind: "government_id", pattern: /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g },
  { kind: "payment", pattern: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g }
];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function redact(value: string, kind: PiiKind): SanitizationResult {
  return { value: placeholder[kind], redactions: [kind] };
}

export function inferSensitiveField(element: RawPageElement): PiiKind | undefined {
  if (element.inputType === "password") return "password";

  const signal = [element.name, element.inputType, element.autocomplete]
    .filter(Boolean)
    .join(" ");

  if (/current-password|new-password|one-time-code/i.test(element.autocomplete ?? "")) {
    return "password";
  }

  return semanticRules.find(({ pattern }) => pattern.test(signal))?.kind;
}

export function sanitizeText(value: string): SanitizationResult {
  let sanitized = value;
  const redactions: PiiKind[] = [];

  for (const { kind, pattern } of inlineRules) {
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) {
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, placeholder[kind]);
      redactions.push(kind);
    }
  }

  return { value: sanitized, redactions: unique(redactions) };
}

export function sanitizeElement(element: RawPageElement): {
  element: SanitizedElement;
  redactions: PiiKind[];
} {
  const fieldKind = inferSensitiveField(element);
  const name = sanitizeText(element.name);
  const text = element.text ? sanitizeText(element.text) : undefined;
  const value = element.value
    ? fieldKind
      ? redact(element.value, fieldKind)
      : sanitizeText(element.value)
    : undefined;

  const redactions = unique([
    ...name.redactions,
    ...(text?.redactions ?? []),
    ...(value?.redactions ?? [])
  ]);

  return {
    element: {
      id: element.id,
      role: element.role,
      name: name.value,
      ...(text ? { text: text.value } : {}),
      ...(value ? { value: value.value } : {}),
      state: element.state
    },
    redactions
  };
}

export function createSanitizedPageContext(raw: RawPageContext): SanitizedPageContext {
  const sanitizedElements = raw.elements.map(sanitizeElement);
  const types = unique(sanitizedElements.flatMap(({ redactions }) => redactions));
  const url = new URL(raw.url);

  return {
    schemaVersion: "1.0",
    source: "nudge-extension",
    page: {
      urlOrigin: url.origin,
      title: sanitizeText(raw.title).value,
      elements: sanitizedElements.map(({ element }) => element),
      redactions: {
        count: sanitizedElements.reduce((total, item) => total + item.redactions.length, 0),
        types
      }
    }
  };
}
