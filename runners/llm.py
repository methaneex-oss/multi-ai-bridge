"""Provider-agnostic LLM caller. OpenRouter-first; works with any OpenAI-compatible API."""

from __future__ import annotations

import os
from typing import Any, Dict, List

import httpx


def _resolve() -> tuple[str, Dict[str, str], str]:
    """Return (base_url, headers, default_model_prefix_hint)."""
    or_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if or_key:
        base = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
        return base, {
            "Authorization": f"Bearer {or_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/methaneex-oss/multi-ai-bridge",
            "X-Title": "Multi-AI Bridge",
        }, "openrouter"

    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_key:
        return "https://api.openai.com/v1", {
            "Authorization": f"Bearer {openai_key}",
            "Content-Type": "application/json",
        }, "openai"

    deepseek = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if deepseek:
        return "https://api.deepseek.com/v1", {
            "Authorization": f"Bearer {deepseek}",
            "Content-Type": "application/json",
        }, "deepseek"

    xai = os.getenv("XAI_API_KEY", "").strip()
    if xai:
        return "https://api.x.ai/v1", {
            "Authorization": f"Bearer {xai}",
            "Content-Type": "application/json",
        }, "xai"

    raise RuntimeError(
        "No API key found. Set OPENROUTER_API_KEY (recommended) or OPENAI_API_KEY / "
        "DEEPSEEK_API_KEY / XAI_API_KEY in the environment."
    )


def normalize_model(model: str, provider_hint: str) -> str:
    """Strip provider prefixes when calling direct OpenAI-compatible endpoints."""
    if provider_hint == "openrouter":
        return model
    # direct OpenAI: openai/gpt-4o -> gpt-4o
    if model.startswith("openai/"):
        return model.split("/", 1)[1]
    if model.startswith("deepseek/"):
        return model.split("/", 1)[1]
    if model.startswith("x-ai/") or model.startswith("xai/"):
        return model.split("/", 1)[1]
    return model


def chat(
    model: str,
    messages: List[Dict[str, str]],
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> str:
    base, headers, hint = _resolve()
    model_id = normalize_model(model, hint)

    payload: Dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    with httpx.Client(timeout=120.0) as client:
        r = client.post(f"{base}/chat/completions", headers=headers, json=payload)
        if r.status_code >= 400:
            raise RuntimeError(f"LLM HTTP {r.status_code}: {r.text[:800]}")
        data = r.json()

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"Unexpected LLM response shape: {data!r}") from e
