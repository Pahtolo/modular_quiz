"""HTTP API surface for Electron frontend integration."""

from .server import create_app

__all__ = ["create_app"]
