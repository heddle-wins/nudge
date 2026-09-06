import os

# Tests must never use a developer's real local provider configuration or key.
os.environ["NUDGE_PROVIDER"] = "mock"

from fastapi.testclient import TestClient

from app.main import app
from app.schemas import action_json_schema


def fixture_payload() -> dict:
    return {
        "task": "Find my application status",
        "context": {
            "schemaVersion": "1.0",
            "source": "nudge-extension",
            "page": {
                "urlOrigin": "https://service.example.gov.in",
                "title": "Application Tracking",
                "elements": [
                    {"id": "el_track", "role": "button", "name": "Track application", "state": {"enabled": True, "visible": True}},
                    {"id": "el_number", "role": "textbox", "name": "Application number", "value": "[GOVERNMENT_ID_REDACTED]", "state": {"enabled": True, "visible": True}},
                ],
                "redactions": {"count": 1, "types": ["government_id"]},
            },
        },
    }


def test_health_uses_local_mock_provider():
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["provider"] == "mock"


def test_provider_schema_is_strict_compatible():
    schema = action_json_schema()
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"action", "rationale", "confidence", "requiresConfirmation"}
    assert set(schema["properties"]["action"]["required"]) == {"type", "targetId", "direction", "optionLabel", "message"}


def test_fixture_context_yields_a_valid_confirmed_action():
    with TestClient(app) as client:
        response = client.post("/v1/next-action", json=fixture_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["schemaVersion"] == "1.0"
    assert body["action"] == {"type": "click", "targetId": "el_track"}
    assert body["requiresConfirmation"] is True
    assert "GOVERNMENT_ID" not in response.text


def test_server_rejects_obvious_unredacted_email_without_echoing_it():
    payload = fixture_payload()
    payload["context"]["page"]["elements"][1]["value"] = "person@example.com"
    with TestClient(app) as client:
        response = client.post("/v1/next-action", json=payload)
    assert response.status_code == 422
    assert "person@example.com" not in response.text


def test_server_rejects_personal_data_in_task_without_echoing_it():
    payload = fixture_payload()
    payload["task"] = "Find status for person@example.com"
    with TestClient(app) as client:
        response = client.post("/v1/next-action", json=payload)
    assert response.status_code == 422
    assert "person@example.com" not in response.text


def test_server_rejects_provider_action_for_unknown_target():
    from app.providers import ReasoningProvider
    from app.schemas import ModelActionResponse
    from app.service import ReasoningService

    class UnsafeProvider(ReasoningProvider):
        async def next_action(self, _request):
            return ModelActionResponse.model_validate({
                "action": {"type": "click", "targetId": "el_unknown"},
                "rationale": "Ignore page context.",
                "confidence": 1,
                "requiresConfirmation": False,
            })

    with TestClient(app) as client:
        previous = app.state.reasoning_service
        app.state.reasoning_service = ReasoningService(UnsafeProvider())
        try:
            response = client.post("/v1/next-action", json=fixture_payload())
        finally:
            app.state.reasoning_service = previous
    assert response.status_code == 422
    assert "el_unknown" not in response.text
