# Nudge reasoning API

The reasoning API accepts only Nudge's sanitized context and returns one schema-validated action proposal. It is stateless and deliberately does not log request bodies, prompts, or provider responses.

## Run locally

`apps/api/.env` defaults to the deterministic `mock` provider, so no API key is needed.

```bash
cd apps/api
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

Then open `http://127.0.0.1:8000/docs` or send a sanitized `POST` request to `/v1/next-action`.

```bash
pytest
```

## Run the local demo stack with Docker

From the repository root:

```bash
docker compose up --build
```

This starts the deterministic mock API at `http://127.0.0.1:8000` and the
fictional SevaSetu portal at `http://127.0.0.1:4173`. Both ports are loopback
only. The browser extension remains unpacked and local; it is not placed in a
container. Stop the stack with `docker compose down`.

Run `npm run smoke:compose` from the repository root to rebuild the stack,
verify the health endpoint, make one sanitized mock reasoning request, verify
the portal, and then remove the containers automatically.

## Deploy with OpenAI Responses API

On the server, use a direct OpenAI provider with a server-only key:

```env
NUDGE_PROVIDER=openai
NUDGE_MODEL=gpt-5-mini
OPENAI_API_KEY=your-server-only-key
```

The protected PNG is sent as an `input_image` part. The API requests a strict JSON schema and does not store the response.

## Deploy with FastRouter

On the VPS, change only these values in `apps/api/.env`:

```env
NUDGE_PROVIDER=fastrouter
NUDGE_MODEL=gpt-5-mini
FASTROUTER_API_KEY=your-server-only-key
```

Never put this key in the extension, browser storage, Vercel environment, or Git. The model is requested with a strict JSON schema; the server independently rejects unknown, hidden, disabled, role-incompatible, malformed, and navigation actions. Every proposal requires confirmation. The extension is the final enforcement point: it re-resolves the live target and applies its local execution policy before any action can run.

## Deploy with a Qwen2.5-VL-compatible endpoint

Nudge can use a self-hosted or managed endpoint that implements OpenAI-compatible `/chat/completions` multimodal requests. Configure its server-only endpoint and key explicitly; no Qwen vendor URL is embedded in Nudge.

```env
NUDGE_PROVIDER=qwen
NUDGE_MODEL=Qwen2.5-VL-7B-Instruct
QWEN_BASE_URL=https://your-qwen-compatible-endpoint/v1
QWEN_API_KEY=your-server-only-key
```

The adapter sends only sanitized context plus the verified redacted PNG. It applies the same redaction-aware prompt and strict action JSON schema as the other providers.
