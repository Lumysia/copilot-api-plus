# Copilot API Proxy

> [!WARNING]
> This project proxies GitHub Copilot into OpenAI-compatible and Anthropic-compatible endpoints. It is unofficial and may break if upstream behavior changes.

## Overview

This service exposes GitHub Copilot through a small compatibility layer so it can be used by tools expecting OpenAI or Anthropic style APIs.

Compared with the original upstream project, this fork keeps the README intentionally simpler and includes support for the `responses` passthrough endpoint.

## Features

- OpenAI-compatible endpoints for chat, models, embeddings, and responses
- Anthropic-compatible messages endpoint
- Optional downstream API key protection from CLI arg or environment variable
- Usage and token inspection endpoints
- Optional rate limit control and manual approval flow
- Support for individual, business, and enterprise Copilot accounts

## Installation

```sh
bun install
```

## Run

Development:

```sh
bun run dev
```

Production:

```sh
bun run start
```

## Common Commands

- Build: `bun run build`
- Lint: `bun run lint`
- Test: `bun test`
- Start: `bun run start`

## API Key Protection

You can require clients to send an API key for all incoming requests.

Priority order:

- CLI arg `--api-key`
- env `API_KEY`
- env `COPILOT_API_KEY`
- default empty, meaning disabled

Example:

`bun run start -- --port 3000 --api-key my-secret-key`

Then call the API with either header:

- `Authorization: Bearer my-secret-key`
- `x-api-key: my-secret-key`

## API Endpoints

### OpenAI-compatible

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/chat/completions` | `POST` | Chat completions passthrough |
| `/v1/chat/completions` | `POST` | Chat completions passthrough |
| `/embeddings` | `POST` | Embeddings passthrough |
| `/v1/embeddings` | `POST` | Embeddings passthrough |
| `/models` | `GET` | Model list |
| `/v1/models` | `GET` | Model list |
| `/responses` | `POST` | Responses passthrough |
| `/v1/responses` | `POST` | Responses passthrough |

### Anthropic-compatible

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/v1/messages` | `POST` | Anthropic messages compatibility |
| `/v1/messages/count_tokens` | `POST` | Token counting |

### Utility

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/usage` | `GET` | Usage information |
| `/token` | `GET` | Current Copilot token |

## `responses` Support

This fork adds direct passthrough for the OpenAI-style `responses` API:

- `POST /responses`
- `POST /v1/responses`

The server forwards the incoming request body to Copilot's `responses` endpoint and returns the upstream response body, headers, and status code directly.

## Notes

- Requires Bun and a valid GitHub Copilot subscription
- Authentication and runtime behavior still follow the existing project implementation
- Use responsibly and avoid abusive automated traffic patterns
