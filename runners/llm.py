"""
Provider-agnostic LLM caller.
Prefers OpenRouter. Falls back to direct provider bases when keys exist.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx

OPENROUTER_BASE = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")


def _headers_for(model: str) -> tuple[str, Dict[str, str]]:
    """Return (base_url, headers) for the given model id."""
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if openrouter_key:
        return OPENROUTER_BASE, {
            "Authorization": f"Bearer {openrouter_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/methaneex-oss/multi-ai-bridge",
            "X-Title": "Multi-AI Bridge",
        }

    # Direct-provider fallbacks (only if no OpenRouter key)
    if model.startswith("openai/") or model.startswith("gpt-"):
        key = os.getenv("OPENAI_API_KEY", "").strip()
        if not key:
            raise RuntimeError("No OPENROUTER_API_KEY or OPENAI_API_KEY")
        return "https://api.openai.com/v1", {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    if model.startswith("anthropic/") or model.startswith("claude"):
        key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        if not key:
            raise RuntimeError("No OPENROUTER_API_KEY or ANTHROPIC_API_KEY")
        # Anthropic has a different API shape; for simplicity we still expect
        # OpenRouter when using Claude unless you extend this branch.
        raise RuntimeError(
            "Direct Anthropic calls need the messages API. "
            "Use OPENROUTER_API_KEY for Claude models."
        )

    if model.startswith("google/") or model.startswith("gemini"):
        key = os.getenv("GOOGLE_API_KEY", "").strip()
        if not key:
            raise RuntimeError("No OPENROUTER_API_KEY or GOOGLE_API_KEY")
        raise RuntimeError(
            "Direct Google calls need a different client. "
            "Use OPENROUTER_API_KEY for Gemini models."
        )

    # Generic OpenAI-compatible endpoint (DeepSeek, xAI, local, etc.)
    for env_name, base in [
        ("DEEPSEEK_API_KEY", "https://api.deepseek.com/v1"),
        ("XAI_API_KEY", "https://api.x.ai/v1"),
    ]:
        key = os.getenv(env_name, "").strip()
        if key:
            return base, {
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            }

    raise RuntimeError(
        "No usable API key found. Set OPENROUTER_API_KEY (recommended) "
        "or a direct provider key in .env"
    )


def chat(
    model: str,
    messages: List[Dict[str, str]],
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> str:
    base, headers = _headers_for(model)

    # OpenRouter and OpenAI-compatible expect the model id as-is
    payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    with httpx.Client(timeout=120.0) as client:
        r = client.post(f"{base}/chat/completions", headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()

    return data["choices"][0]["message"]["content"]
