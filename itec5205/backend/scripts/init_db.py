"""One-off: create ArangoDB collections + indexes. Safe to re-run.

Usage:
    python scripts/init_db.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db.arango_client import COLLECTIONS, ensure_collections  # noqa: E402

if __name__ == "__main__":
    ensure_collections()
    print(f"Ready: {', '.join(COLLECTIONS)}")
