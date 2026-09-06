from enum import Enum
from typing import Annotated, Literal

from pydantic import AnyUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PiiKind(str, Enum):
    password = "password"
    email = "email"
    phone = "phone"
    government_id = "government_id"
    payment = "payment"
    account_number = "account_number"
    address = "address"
    date_of_birth = "date_of_birth"
    token = "token"
    user_marked = "user_marked"


class ElementState(StrictModel):
    enabled: bool
    visible: bool
    required: bool | None = None


class SanitizedElement(StrictModel):
    id: Annotated[str, Field(pattern=r"^el_[A-Za-z0-9_-]{1,120}$")]
    role: Literal["button", "link", "textbox", "combobox", "checkbox", "radio", "select", "heading", "text", "unknown"]
    name: Annotated[str, Field(min_length=0, max_length=500)]
    text: Annotated[str, Field(max_length=2_000)] | None = None
    value: Annotated[str, Field(max_length=500)] | None = None
    state: ElementState


class Redactions(StrictModel):
    count: Annotated[int, Field(ge=0)]
    types: list[PiiKind]


class SanitizedPage(StrictModel):
    urlOrigin: AnyUrl
    title: Annotated[str, Field(max_length=500)]
    elements: Annotated[list[SanitizedElement], Field(max_length=500)]
    redactions: Redactions


class SanitizedContext(StrictModel):
    schemaVersion: Literal["1.0"]
    source: Literal["nudge-extension"]
    page: SanitizedPage


class NextActionRequest(StrictModel):
    task: Annotated[str, Field(min_length=1, max_length=1_000)]
    context: SanitizedContext


class ActionType(str, Enum):
    click = "click"
    scroll = "scroll"
    select = "select"
    type = "type"
    navigate = "navigate"
    request_user_input = "request_user_input"
    report_result = "report_result"


class ProposedAction(StrictModel):
    type: ActionType
    targetId: Annotated[str, Field(pattern=r"^el_[A-Za-z0-9_-]{1,120}$")] | None = None
    direction: Literal["up", "down"] | None = None
    optionLabel: Annotated[str, Field(max_length=300)] | None = None
    message: Annotated[str, Field(max_length=1_000)] | None = None


class ModelActionResponse(StrictModel):
    action: ProposedAction
    rationale: Annotated[str, Field(min_length=1, max_length=1_000)]
    confidence: Annotated[float, Field(ge=0, le=1)]
    requiresConfirmation: bool


class NextActionResponse(ModelActionResponse):
    schemaVersion: Literal["1.0"] = "1.0"


def action_json_schema() -> dict:
    """Strict OpenAI-compatible schema used at the provider boundary.

    Strict mode requires every declared field to be required. Fields that do not
    apply to an action are therefore nullable; FastAPI omits those null values
    before returning the proposal to the extension.
    """
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "action": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "type": {"type": "string", "enum": [kind.value for kind in ActionType]},
                    "targetId": {"type": ["string", "null"]},
                    "direction": {"type": ["string", "null"], "enum": ["up", "down", None]},
                    "optionLabel": {"type": ["string", "null"]},
                    "message": {"type": ["string", "null"]},
                },
                "required": ["type", "targetId", "direction", "optionLabel", "message"],
            },
            "rationale": {"type": "string"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "requiresConfirmation": {"type": "boolean"},
        },
        "required": ["action", "rationale", "confidence", "requiresConfirmation"],
    }
