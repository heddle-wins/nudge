"""Server-side defence in depth. The extension remains the enforcement point."""

import re

from .schemas import NextActionRequest

RAW_SECRET_PATTERNS = (
    re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    re.compile(r"\b(?:\+?91[- ]?)?[6-9]\d{9}\b"),
    re.compile(r"\b\d{4}[ -]?\d{4}[ -]?\d{4}(?:[ -]?\d{1,7})?\b"),
    re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.IGNORECASE),
)


def assert_no_obvious_raw_pii(request: NextActionRequest) -> None:
    """Reject obvious PII as defence in depth; never log the rejected value."""
    if any(pattern.search(request.task) for pattern in RAW_SECRET_PATTERNS):
        raise ValueError("Request contains a value that appears to be unredacted personal data.")
    if any(pattern.search(request.context.page.title) for pattern in RAW_SECRET_PATTERNS):
        raise ValueError("Request contains a value that appears to be unredacted personal data.")
    for element in request.context.page.elements:
        for candidate in (element.name, element.text, element.value):
            if candidate and any(pattern.search(candidate) for pattern in RAW_SECRET_PATTERNS):
                raise ValueError("Request contains a value that appears to be unredacted personal data.")
