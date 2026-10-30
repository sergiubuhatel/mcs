#!/bin/bash
# =============================================================================
# Keycloak Initial Settings Restore
# Automatically finds and restores master and dta realm backups from
# the backup_initial_settings directory.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/backup_initial_settings"
RESTORE_SCRIPT="$SCRIPT_DIR/restore_realm.sh"

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

[ -d "$BACKUP_DIR" ] || fail "Backup directory not found: $BACKUP_DIR"
[ -f "$RESTORE_SCRIPT" ] || fail "restore_realm.sh not found: $RESTORE_SCRIPT"

# Find master and dta backup files
MASTER_FILE=$(find "$BACKUP_DIR" -maxdepth 1 -name "*_master_*.json" | sort | tail -1)
DTA_FILE=$(find "$BACKUP_DIR" -maxdepth 1 -name "*_dta_*.json" | sort | tail -1)

[ -n "$MASTER_FILE" ] || fail "No master realm backup found in $BACKUP_DIR"
[ -n "$DTA_FILE" ]    || fail "No dta realm backup found in $BACKUP_DIR"

log "Found master backup : $MASTER_FILE"
log "Found dta backup    : $DTA_FILE"
echo

log "=== Restoring master realm ==="
bash "$RESTORE_SCRIPT" "$MASTER_FILE" -r master
echo

log "=== Restoring dta realm ==="
bash "$RESTORE_SCRIPT" "$DTA_FILE" -r dta
echo

log "Initial settings restore complete."
