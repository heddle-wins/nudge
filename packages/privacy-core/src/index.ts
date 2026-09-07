import type { PiiKind, SanitizedElement, SanitizedPageContext } from "@nudge/contracts";

export type RawPageElement = {
  id: string;
  role: SanitizedElement["role"];
  name: string;
  text?: string;
  value?: string;
  inputType?: string;
  autocomplete?: string;
  /** Set only by a local, user-initiated privacy mark. Never exported. */
  userMarkedPrivate?: boolean;
  /** Viewport-relative bounds, used only to locally mask a screenshot. */
  bounds?: { x: number; y: number; width: number; height: number };
  state: SanitizedElement["state"];
};

export type RawPageContext = {
  url: string;
  title: string;
  elements: RawPageElement[];
  viewport?: { width: number; height: number };
  visualScanComplete?: boolean;
  hasUninspectableVisualContent?: boolean;
  /** Text and fields considered only when preparing a local viewport preview. */
  visualElements?: RawPageElement[];
};

export type VisualRedactionRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: PiiKind;
  /** DOM regions use viewport CSS pixels; model regions use captured-image pixels. */
  coordinateSpace?: "viewport" | "image";
};

export type PrivacyInspection = {
  context: SanitizedPageContext;
  /** Local-only geometry. This is deliberately not part of the outbound contract. */
  visualRedactions: VisualRedactionRegion[];
  /** Safe, human-readable explanation for the extension UI; never sent to a server. */
  redactionDetails: RedactionDetail[];
};

export type RedactionDetail = {
  kind: PiiKind;
  location: string;
  source: "page_title" | "element_name" | "visible_text" | "field_value";
};

export type SanitizationResult = {
  value: string;
  redactions: PiiKind[];
};

const placeholder: Record<PiiKind, string> = {
  face: "[FACE_REDACTED]",
  password: "[PASSWORD_REDACTED]",
  email: "[EMAIL_REDACTED]",
  phone: "[PHONE_REDACTED]",
  government_id: "[ID_REDACTED]",
  payment: "[PAYMENT_REDACTED]",
  account_number: "[ACCOUNT_REDACTED]",
  address: "[ADDRESS_REDACTED]",
  date_of_birth: "[DOB_REDACTED]",
  token: "[TOKEN_REDACTED]",
  user_marked: "[PRIVATE_REDACTED]"
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
  { kind: "payment", pattern: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g },
  // Do not consume the first twelve digits of a longer payment/account value.
  { kind: "government_id", pattern: /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?![\d\s-]*\d)/g },
  { kind: "government_id", pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  // Indian voter IDs and passports often appear in OCR output without a label.
  { kind: "government_id", pattern: /\b[A-Z]{3}\s?\d{7}\b/g },
  { kind: "government_id", pattern: /\b[A-PR-WY]\d{7}\b/g },
  // IFSC is a bank-routing identifier: four bank letters, a zero, then six characters.
  { kind: "account_number", pattern: /\b[A-Z]{4}\s?0[A-Z0-9]{6}\b/g },
  { kind: "account_number", pattern: /(?<!\d)\d{9,18}(?!\d)/g },
  // Catch full tokens as well as intentionally truncated dashboard representations.
  { kind: "token", pattern: /\b(?:Bearer\s+)?(?:sk|pk|api)[_-][A-Za-z0-9._-]{6,}\b/g }
];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function redact(value: string, kind: PiiKind): SanitizationResult {
  return { value: placeholder[kind], redactions: [kind] };
}

export function inferSensitiveField(element: RawPageElement): PiiKind | undefined {
  if (element.userMarkedPrivate) return "user_marked";
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
  const name = fieldKind === "user_marked" ? redact(element.name, fieldKind) : sanitizeText(element.name);
  const text = element.text
    ? fieldKind
      ? redact(element.text, fieldKind)
      : sanitizeText(element.text)
    : undefined;
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

function toVisualRedactions(elements: RawPageElement[]): VisualRedactionRegion[] {
  const regions: VisualRedactionRegion[] = [];
  for (const rawElement of elements) {
    if (!rawElement.bounds || rawElement.bounds.width <= 0 || rawElement.bounds.height <= 0) continue;
    const { redactions } = sanitizeElement(rawElement);
    for (const kind of redactions) {
      regions.push({ ...rawElement.bounds, kind });
    }
  }
  return regions;
}

export function createPrivacyInspection(raw: RawPageContext): PrivacyInspection {
  const sanitizedElements = raw.elements.map(sanitizeElement);
  const title = sanitizeText(raw.title);
  const types = unique([...title.redactions, ...sanitizedElements.flatMap(({ redactions }) => redactions)]);
  const url = new URL(raw.url);
  const redactionDetails: RedactionDetail[] = title.redactions.map((kind) => ({
    kind,
    location: "Page title",
    source: "page_title"
  }));

  for (let index = 0; index < sanitizedElements.length; index += 1) {
    const { element, redactions } = sanitizedElements[index];
    const rawElement = raw.elements[index];
    const fieldKind = inferSensitiveField(rawElement);
    const location = fieldKind === "user_marked" ? "User-marked element" : element.name || "Unlabelled element";
    for (const kind of redactions) {
      const source = rawElement.value
        ? "field_value"
        : rawElement.text
          ? "visible_text"
          : "element_name";
      redactionDetails.push({ kind, location, source });
    }
  }

  return {
    context: {
      schemaVersion: "1.0",
      source: "nudge-extension",
      page: {
        urlOrigin: url.origin,
        title: title.value,
        elements: sanitizedElements.map(({ element }) => element),
        redactions: {
          count: title.redactions.length + sanitizedElements.reduce((total, item) => total + item.redactions.length, 0),
          types
        }
      }
    },
    visualRedactions: toVisualRedactions([...(raw.visualElements ?? []), ...raw.elements]),
    redactionDetails
  };
}

export function createSanitizedPageContext(raw: RawPageContext): SanitizedPageContext {
  return createPrivacyInspection(raw).context;
}

/** Fail closed when the local renderer cannot account for every visible region. */
export function canExportRedactedViewport(raw: RawPageContext): boolean {
  return raw.visualScanComplete !== false && raw.hasUninspectableVisualContent !== true;
}

function matchedValues(value: string): string[] {
  const matches: string[] = [];
  for (const { pattern } of inlineRules) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) matches.push(match[0]);
  }
  return matches;
}

/**
 * The only constructor future network code may use. It makes the privacy invariant
 * executable: source values classified as private, or matched as PII, must not be
 * present in the serialized context.
 */
export function createOutboundSafeContext(raw: RawPageContext): SanitizedPageContext {
  const context = createSanitizedPageContext(raw);
  const payload = JSON.stringify(context);
  const protectedValues = new Set<string>();

  for (const element of [...raw.elements, ...(raw.visualElements ?? [])]) {
    const fieldKind = inferSensitiveField(element);
    if (fieldKind === "user_marked") {
      for (const value of [element.name, element.text, element.value]) {
        if (value) protectedValues.add(value);
      }
    } else if (fieldKind && element.value) {
      // A semantic label such as “Password” is allowed to remain as useful UI
      // structure; the field's actual value is never allowed through.
      protectedValues.add(element.value);
    }
    for (const value of [element.name, element.text, element.value]) {
      if (value) for (const match of matchedValues(value)) protectedValues.add(match);
    }
  }
  for (const match of matchedValues(raw.title)) protectedValues.add(match);
  for (const match of matchedValues(raw.url)) protectedValues.add(match);

  for (const value of protectedValues) {
    if (value && payload.includes(value)) {
      throw new Error("Unsafe outbound context blocked: a protected source value survived redaction.");
    }
  }
  return context;
}
