"""One-off: create ArangoDB collections + indexes. Safe to re-run.

Retries while ArangoDB is still starting, so docker-compose's `init-db`
service can run it right after the arangodb container comes up.

Usage:
    python scripts/init_db.py
"""

import os
import sys


sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db.arango_client import COLLECTIONS  # noqa: E402
from app.db.migrations import upgrade  # noqa: E402

if __name__ == "__main__":
    # Schema only (collections, indexes, renames); the backend fills missing
    # data in the background when it starts (app/db/migrations.py).
    upgrade(data=False)
    print(f"Ready: {', '.join(COLLECTIONS)}")
