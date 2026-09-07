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
