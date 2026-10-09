"""One-off: create ArangoDB collections + indexes. Safe to re-run.

Retries while ArangoDB is still starting, so docker-compose's `init-db`
service can run it right after the arangodb container comes up.

Usage:
    python scripts/init_db.py
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db.arango_client import COLLECTIONS, ensure_collections, get_db  # noqa: E402

ATTEMPTS = 60
DELAY_SECONDS = 2

if __name__ == "__main__":
    for attempt in range(1, ATTEMPTS + 1):
        try:
            ensure_collections()
            break
        except Exception as exc:  # noqa: BLE001 - connection refused / 503 while ArangoDB boots
            if attempt == ATTEMPTS:
                raise
            print(f"ArangoDB not ready ({exc.__class__.__name__}), retry {attempt}/{ATTEMPTS}...", flush=True)
            get_db.cache_clear()
            time.sleep(DELAY_SECONDS)
    print(f"Ready: {', '.join(COLLECTIONS)}")
