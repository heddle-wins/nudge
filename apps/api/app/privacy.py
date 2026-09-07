"""Server-side defence in depth. The extension remains the enforcement point."""

import base64
import hashlib
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
    if request.screenshot:
        encoded = request.screenshot.dataUrl.split(",", 1)[1]
        try:
            image = base64.b64decode(encoded, validate=True)
        except ValueError as error:
            raise ValueError("Protected screenshot is not valid base64.") from error
        if hashlib.sha256(image).hexdigest() != request.screenshot.sha256:
            raise ValueError("Protected screenshot receipt does not match its image.")
