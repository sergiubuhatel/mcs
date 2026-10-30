# Keycloak Backup & Restore

| Script | Use case | Passwords |
|--------|----------|-----------|
| `backup_realm.bat` / `.sh` | Full realm backup — local Docker | ✅ Yes |
| `restore_realm.bat` / `.sh` | Full realm restore — local Docker | — |
| `backup_users.bat` / `.sh` | Users only backup — local Docker | ✅ Yes |
| `restore_users.bat` / `.sh` | Users only restore — local Docker | — |

> The Keycloak REST API never exports password hashes. To back up a remote server with passwords, SSH in and run `backup_realm.sh` on the remote machine.

---

## backup_realm — Local (with passwords)

Stops the Docker container, exports directly from the database, restarts.

| Option | Description | Default |
|--------|-------------|---------|
| `-r` | Realm to export | `master` |
| `-o` | Output directory | `.\backups` |
| `-c` | Container name | `keycloak-https` |
| `-n` | Docker network | `keycloak_default` |
| `-D` | Database type | `postgres` |
| `-U` | DB JDBC URL | `jdbc:postgresql://postgres:5432/keycloak` |
| `-u` | DB username | `keycloak` |
| `-p` | DB password | `password` |
| `-i` | Keycloak image | `quay.io/keycloak/keycloak:26.2.3` |

```bat
backup_realm.bat -r dta
backup_realm.bat -r dta -o C:\backups\keycloak
```

```bash
./backup_realm.sh -r dta
./backup_realm.sh -r dta -o /mnt/backups/keycloak
```

---

## Remote Full Backup via SSH (with passwords)

SSH into the remote server, run `backup_realm.sh` there, copy the file back.

```bat
:: Windows
ssh user@10.152.0.202 "cd /path/to/keycloak && ./backup_realm.sh -r dta -o /tmp/kc_backups"
scp user@10.152.0.202:/tmp/kc_backups/keycloak_realm_dta_*.json C:\backups\keycloak\
```

```bash
# Linux
ssh user@10.152.0.202 "cd /path/to/keycloak && ./backup_realm.sh -r dta -o /tmp/kc_backups"
scp user@10.152.0.202:/tmp/kc_backups/keycloak_realm_dta_*.json ./backups/
```

---

## restore_realm — Restore

Stops the Docker container, imports the backup, restarts. Overwrites the realm if it already exists.

| Option | Description | Default |
|--------|-------------|---------|
| *(positional)* | Path to backup JSON | *(required)* |
| `-r` | Realm name | `master` |
| `-c` | Container name | `keycloak-https` |
| `-n` | Docker network | `keycloak_default` |
| `-D` | Database type | `postgres` |
| `-U` | DB JDBC URL | `jdbc:postgresql://postgres:5432/keycloak` |
| `-u` | DB username | `keycloak` |
| `-p` | DB password | `password` |
| `-i` | Keycloak image | `quay.io/keycloak/keycloak:26.2.3` |

```bat
restore_realm.bat C:\backups\keycloak\keycloak_realm_dta_20260930_091440.json -r dta
```

```bash
./restore_realm.sh ./backups/keycloak_realm_dta_20260930_091440.json -r dta
```

---

## backup_users / restore_users — Users Only

Backs up and restores only the users of a realm, leaving all other realm configuration (clients, roles, authentication flows, etc.) untouched. Includes password hashes.

> **restore_users replaces all users** in the realm with those from the backup. Users not present in the backup will be deleted.

Same options as `backup_realm` / `restore_realm`.

```bat
:: Windows
backup_users.bat -r dta -o C:\backups\keycloak
restore_users.bat C:\backups\keycloak\keycloak_users_dta_20260930_091440.json -r dta
```

```bash
# Linux
./backup_users.sh -r dta -o /mnt/backups/keycloak
./restore_users.sh ./backups/keycloak_users_dta_20260930_091440.json -r dta
```

Output file: `keycloak_users_<realm>_<timestamp>.json`

---

## Workflows

### Local backup and restore
```bat
backup_realm.bat -r dta -o C:\backups\keycloak
restore_realm.bat C:\backups\keycloak\keycloak_realm_dta_20260930_091440.json -r dta
```

### Remote backup with passwords (SSH)
```bat
ssh user@10.152.0.202 "cd /path/to/keycloak && ./backup_realm.sh -r dta -o /tmp/kc_backups"
scp user@10.152.0.202:/tmp/kc_backups/keycloak_realm_dta_*.json C:\backups\keycloak\
restore_realm.bat C:\backups\keycloak\keycloak_realm_dta_20260930_091440.json -r dta
```

### Users only backup and restore
```bat
backup_users.bat -r dta -o C:\backups\keycloak
restore_users.bat C:\backups\keycloak\keycloak_users_dta_20260930_091440.json -r dta
```

```bash
./backup_users.sh -r dta -o /mnt/backups/keycloak
./restore_users.sh ./backups/keycloak_users_dta_20260930_091440.json -r dta
```
