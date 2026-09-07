import os
import asyncio
import base64
import hashlib

import httpx

# Tests must never use a developer's real local provider configuration or key.
os.environ["NUDGE_PROVIDER"] = "mock"

from fastapi.testclient import TestClient

from app.main import app
from app.schemas import action_json_schema


def fixture_payload() -> dict:
    return {
        "task": "Find my application status",
        "redactionManifest": {"count": 1, "types": ["government_id"], "visualMaskCount": 1, "renderer": "local-canvas-dom-v1"},
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


def test_server_accepts_a_verified_redacted_screenshot_receipt():
    payload = fixture_payload()
    image = b"redacted-png-fixture"
    payload["screenshot"] = {
        "kind": "nudge-redacted-screenshot",
        "mimeType": "image/png",
        "dataUrl": "data:image/png;base64," + base64.b64encode(image).decode(),
        "sha256": hashlib.sha256(image).hexdigest(),
        "width": 100,
        "height": 50,
    }
    with TestClient(app) as client:
        response = client.post("/v1/next-action", json=payload)
    assert response.status_code == 200


def test_server_rejects_a_tampered_screenshot_receipt():
    payload = fixture_payload()
    payload["screenshot"] = {
        "kind": "nudge-redacted-screenshot", "mimeType": "image/png",
        "dataUrl": "data:image/png;base64,cmVkYWN0ZWQ=", "sha256": "0" * 64,
        "width": 100, "height": 50,
    }
    with TestClient(app) as client:
        response = client.post("/v1/next-action", json=payload)
    assert response.status_code == 422


def test_multimodal_provider_sends_only_the_verified_receipt_as_an_image_part(monkeypatch):
    from app.config import Settings
    from app.providers import FastRouterProvider
    from app.schemas import NextActionRequest

    payload = fixture_payload()
    image = b"redacted-png-fixture"
    data_url = "data:image/png;base64," + base64.b64encode(image).decode()
    payload["screenshot"] = {
        "kind": "nudge-redacted-screenshot", "mimeType": "image/png", "dataUrl": data_url,
        "sha256": hashlib.sha256(image).hexdigest(), "width": 100, "height": 50,
    }
    captured: dict = {}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, _path, json, headers):
            captured["json"] = json
            captured["headers"] = headers
            return httpx.Response(200, json={"choices": [{"message": {"content": '{"action":{"type":"click","targetId":"el_track"},"rationale":"Use the visible control.","confidence":0.8,"requiresConfirmation":true}'}}]})

    monkeypatch.setattr("app.providers.httpx.AsyncClient", lambda **_kwargs: FakeClient())
    provider = FastRouterProvider(Settings(provider="fastrouter", fastrouter_api_key="test-key"))
    result = asyncio.run(provider.next_action(NextActionRequest.model_validate(payload)))

    content = captured["json"]["messages"][1]["content"]
    assert result.action.targetId == "el_track"
    assert content[1] == {"type": "image_url", "image_url": {"url": data_url}}
    assert "screenshot" not in content[0]["text"]
    assert "never infer, reconstruct, repeat, request, or act" in captured["json"]["messages"][0]["content"]
    assert "blacked-out image regions" in captured["json"]["messages"][0]["content"]


def test_openai_responses_provider_sends_the_receipt_as_a_low_detail_image(monkeypatch):
    from app.config import Settings
    from app.providers import OpenAIResponsesProvider
    from app.schemas import NextActionRequest

    payload = fixture_payload()
    image = b"redacted-png-fixture"
    data_url = "data:image/png;base64," + base64.b64encode(image).decode()
    payload["screenshot"] = {
        "kind": "nudge-redacted-screenshot", "mimeType": "image/png", "dataUrl": data_url,
        "sha256": hashlib.sha256(image).hexdigest(), "width": 100, "height": 50,
    }
    captured: dict = {}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, path, json, headers):
            captured.update(path=path, json=json, headers=headers)
            return httpx.Response(200, json={"output": [{"type": "message", "content": [{"type": "output_text", "text": '{"action":{"type":"click","targetId":"el_track"},"rationale":"Use the visible control.","confidence":0.8,"requiresConfirmation":true}'}]}]})

    monkeypatch.setattr("app.providers.httpx.AsyncClient", lambda **_kwargs: FakeClient())
    provider = OpenAIResponsesProvider(Settings(provider="openai", openai_api_key="test-key"))
    result = asyncio.run(provider.next_action(NextActionRequest.model_validate(payload)))

    content = captured["json"]["input"][0]["content"]
    assert result.action.targetId == "el_track"
    assert captured["path"] == "/responses"
    assert captured["json"]["store"] is False
    assert content[1] == {"type": "input_image", "image_url": data_url, "detail": "low"}
    assert "screenshot" not in content[0]["text"]
    assert "never infer, reconstruct, repeat, request, or act" in captured["json"]["instructions"]
    assert "blacked-out image regions" in captured["json"]["instructions"]


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
