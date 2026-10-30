"""Who is calling: the Keycloak access token sent as `Authorization: Bearer`.

The token is verified with the Carleton realm's public signing keys (fetched
once from Keycloak's JWKS endpoint and cached), so no Keycloak admin
credentials are needed. The issuer isn't checked because it depends on the
host the browser used (localhost or the tunnel); the signature plus the
`azp` (our client) is what matters.
"""

import logging
from functools import wraps

import jwt
from flask import g, jsonify, request

from . import config

log = logging.getLogger(__name__)

ROLES = ("installer", "admin", "operator")
ADMIN_ROLES = {"admin", "installer"}  # installer is a superset of admin

_jwks = None


def _jwks_client():
    global _jwks
    if _jwks is None:
        _jwks = jwt.PyJWKClient(
            f"{config.KEYCLOAK_URL}/realms/{config.KEYCLOAK_REALM}/protocol/openid-connect/certs",
            cache_keys=True,
            lifespan=3600,
        )
    return _jwks


def _verify(header: str) -> dict | None:
    if not header.startswith("Bearer "):
        return None
    return verify_token(header[len("Bearer "):])


def verify_token(token: str) -> dict | None:
    """The user a Keycloak access token belongs to, or None if it isn't valid."""
    try:
        key = _jwks_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(token, key.key, algorithms=[key.algorithm_name], options={"verify_aud": False}, leeway=30)
    except Exception as exc:  # bad/expired token, or Keycloak unreachable
        log.warning("Rejected access token: %s", exc)
        return None
    if claims.get("azp") != config.KEYCLOAK_CLIENT:
        return None
    username = claims.get("preferred_username")
    return {
        "id": claims["sub"],
        "sid": claims.get("sid"),  # Keycloak session: a new one per sign-in
        "username": username,
        "name": claims.get("name") or username,
        "roles": [r for r in (claims.get("realm_access") or {}).get("roles", []) if r in ROLES],
    }


def current_user() -> dict | None:
    """The verified caller of this request, or None (no/invalid token)."""
    if "user" not in g:
        g.user = _verify(request.headers.get("Authorization", "")) if config.KEYCLOAK_ENABLED else None
    return g.user


def is_admin(user: dict | None) -> bool:
    return bool(user) and bool(ADMIN_ROLES & set(user["roles"]))


def require_admin(view):
    """Admins and installers only (whole-database actions)."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        if config.KEYCLOAK_ENABLED:
            user = current_user()
            if user is None:
                return jsonify({"error": "Sign in first"}), 401
            if not is_admin(user):
                return jsonify({"error": "Only admins can do this"}), 403
        return view(*args, **kwargs)

    return wrapper
