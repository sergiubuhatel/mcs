"""Turn the realm backups in backup_initial_settings/ into Keycloak import files.

    python prepare_import.py <backup_dir> <out_dir>

The backup dir holds two realm exports (backup_realm.sh): the master realm
and the application realm. This writes <out_dir>/master-realm.json and
<out_dir>/Carleton-realm.json, which Keycloak loads on startup
(`start --import-realm`, files in /opt/keycloak/data/import). Realms that
already exist are skipped by Keycloak, so this only initializes a fresh
database.

The application realm's old name is read from its backup and replaced
everywhere by `Carleton`:
  * realm name and its URLs (/realms/<old>/, /admin/<old>/);
  * realm roles `<old>_admin_role` / `<old>_operator_role` /
    `<old>_installer_role` -> `admin` / `operator` / `installer`;
  * other names prefixed with it -- client `<old>_client` -> `carleton_client`,
    master user `<old>_admin` -> `carleton_admin`, the default role, and the
    `<old>-realm` admin client in master;
  * every realm uses the `carleton` login theme (Carleton University logo).
Only the application users in KEEP_USERS are imported (with their password
hashes); all other settings are kept as they are.
"""

import glob
import json
import os
import sys

NEW_REALM = "Carleton"
NEW_PREFIX = "carleton"
LOGIN_THEME = "carleton"
# Application users to keep (master keeps its Keycloak admin accounts).
KEEP_USERS = {"sbuhatel"}


def make_renamer(old):
    exact = {
        old: NEW_REALM,
        f"default-roles-{old}": f"default-roles-{NEW_REALM.lower()}",
        f"{old}-realm": f"{NEW_REALM}-realm",
        f"{old} Realm": f"{NEW_REALM} Realm",
    }
    paths = {
        f"/realms/{old}/": f"/realms/{NEW_REALM}/",
        f"/admin/{old}/": f"/admin/{NEW_REALM}/",
    }

    def rename(value):
        if isinstance(value, dict):
            # Keys too: client roles are keyed by clientId.
            return {rename(k): rename(v) for k, v in value.items()}
        if isinstance(value, list):
            return [rename(v) for v in value]
        if isinstance(value, str):
            if value in exact:
                return exact[value]
            if value.startswith(f"{old}_") and value.endswith("_role"):
                return value[len(old) + 1:-len("_role")]
            if value.startswith(f"{old}_"):
                return NEW_PREFIX + value[len(old):]
            for o, n in paths.items():
                value = value.replace(o, n)
        return value

    return rename


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(realm, path):
    realm["loginTheme"] = LOGIN_THEME
    with open(path, "w", encoding="utf-8") as f:
        json.dump(realm, f, indent=2)
    print(f"-> {path} (realm {realm['realm']})")


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    backup_dir, out_dir = sys.argv[1], sys.argv[2]

    files = sorted(glob.glob(os.path.join(backup_dir, "*.json")))
    realms = [load(f) for f in files]
    master = [r for r in realms if r["realm"] == "master"]
    apps = [r for r in realms if r["realm"] != "master"]
    if not master or not apps:
        sys.exit(f"Need a master and an application realm backup in {backup_dir}")
    # Latest file wins when several backups of the same realm exist.
    master, app = master[-1], apps[-1]

    rename = make_renamer(app["realm"])
    app["users"] = [
        u for u in app.get("users", [])
        if u["username"] in KEEP_USERS or u.get("serviceAccountClientId")
    ]
    os.makedirs(out_dir, exist_ok=True)
    save(rename(master), os.path.join(out_dir, "master-realm.json"))
    save(rename(app), os.path.join(out_dir, f"{NEW_REALM}-realm.json"))


if __name__ == "__main__":
    main()
