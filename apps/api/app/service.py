from .privacy import assert_no_obvious_raw_pii
from .providers import ReasoningProvider
from .schemas import ActionType, ModelActionResponse, NextActionRequest, NextActionResponse


def validate_action(action: ModelActionResponse, request: NextActionRequest) -> NextActionResponse:
    """Treat the model output as untrusted and enforce server-side action constraints."""
    elements = {element.id: element for element in request.context.page.elements}
    proposed = action.action

    if proposed.type in {ActionType.click, ActionType.select, ActionType.type}:
        if not proposed.targetId or proposed.targetId not in elements:
            raise ValueError("Action references an unknown target.")
        target = elements[proposed.targetId]
        if not target.state.visible or not target.state.enabled:
            raise ValueError("Action references a hidden or disabled target.")
        allowed_roles = {
            ActionType.click: {"button", "link", "checkbox", "radio"},
            ActionType.select: {"select", "combobox"},
            ActionType.type: {"textbox", "combobox"},
        }
        if target.role not in allowed_roles[proposed.type]:
            raise ValueError("Action is not compatible with its target role.")

    if proposed.type == ActionType.scroll and proposed.direction is None:
        raise ValueError("Scroll actions require a direction.")
    if proposed.type == ActionType.select and not proposed.optionLabel:
        raise ValueError("Select actions require a visible option label.")
    if proposed.type in {ActionType.request_user_input, ActionType.report_result} and not proposed.message:
        raise ValueError("This action requires a user-visible message.")
    if proposed.type == ActionType.navigate:
        raise ValueError("Navigate is reserved until the extension has an allowlist validator.")

    # Confirmation is mandatory for Phase 3. Phase 4 may loosen only low-risk actions locally.
    return NextActionResponse(
        action=proposed,
        rationale=action.rationale,
        confidence=action.confidence,
        requiresConfirmation=True,
    )


class ReasoningService:
    def __init__(self, provider: ReasoningProvider):
        self._provider = provider

    async def next_action(self, request: NextActionRequest) -> NextActionResponse:
        assert_no_obvious_raw_pii(request)
        proposal = await self._provider.next_action(request)
        return validate_action(proposal, request)
