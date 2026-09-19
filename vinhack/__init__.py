"""VinHack package.

Reads .env first so ANTHROPIC_API_KEY and LLM_MODEL are available to every
module that imports os.environ at module scope.
"""
import os
from pathlib import Path


def _load_dotenv() -> None:
    """Minimal .env reader - not worth a dependency for three settings.

    A real environment variable always wins over the file, so `set LLM_MODEL=...`
    in the shell still overrides it.
    """
    path = Path(__file__).resolve().parent.parent / ".env"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()
