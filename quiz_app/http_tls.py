from __future__ import annotations

import ssl
import urllib.request
from functools import lru_cache
from typing import Any

try:
    import certifi
except Exception:  # pragma: no cover - fallback when certifi is unavailable
    certifi = None


@lru_cache(maxsize=1)
def default_ssl_context() -> ssl.SSLContext:
    cafile = None
    if certifi is not None:
        try:
            cafile = certifi.where()
        except Exception:
            cafile = None
    if cafile:
        return ssl.create_default_context(cafile=cafile)
    return ssl.create_default_context()


def urlopen_with_trust_store(target: Any, *, timeout: float):
    return urllib.request.urlopen(target, timeout=timeout, context=default_ssl_context())
