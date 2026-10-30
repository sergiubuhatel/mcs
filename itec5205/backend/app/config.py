"""Environment-driven configuration shared by the Flask app and Celery workers."""

import os

ARANGO_HOST = os.environ.get("ARANGO_HOST", "http://localhost:8529")
ARANGO_DB = os.environ.get("ARANGO_DB", "investing")
ARANGO_USER = os.environ.get("ARANGO_USER", "root")
ARANGO_PASSWORD = os.environ.get("ARANGO_PASSWORD", "")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", REDIS_URL)
# Separate logical Redis DB for Flask-SocketIO's pub/sub message_queue so its
# Kombu connection pool never shares a pool key with Celery's broker/backend.
SOCKETIO_REDIS_URL = os.environ.get("SOCKETIO_REDIS_URL", REDIS_URL.rsplit("/", 1)[0] + "/1")

# Path is relative to the repo root (mounted the same way in every container).
TICKERS_FILE = os.environ.get("TICKERS_FILE", "/data/tickers.txt")  # S&P 500
RUSSELL3000_FILE = os.environ.get("RUSSELL3000_FILE", "/data/russell3000.txt")
RL_MODELS_DIR = os.environ.get("RL_MODELS_DIR", "/data/rl_models")

CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")

# Keycloak (login). Internal URL: the backend reaches Keycloak directly on the
# compose network; only the realm's public keys are fetched (no admin login).
KEYCLOAK_ENABLED = os.environ.get("KEYCLOAK_ENABLED", "true").lower() != "false"
KEYCLOAK_URL = os.environ.get("KEYCLOAK_URL", "http://keycloak:8080/auth")
KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "Carleton")
KEYCLOAK_CLIENT = os.environ.get("KEYCLOAK_CLIENT", "carleton_client")
