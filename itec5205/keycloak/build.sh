#\!/bin/bash

# -----------------------------------------------------------
# Keycloak Build Script
#
# Usage:
#   ./build.sh          # build and package
#
# Requirements:
#   - makeself must be installed
#   - Run from the keycloak/ directory (SVN working copy)
# -----------------------------------------------------------

set -e

version=$(date +"%Y.%m.%d")

if [ -d tmp ]; then
    rm -rf tmp
fi

mkdir tmp
echo "Creating installer..."

cp deploy/install.sh tmp/
cp docker-compose.yml tmp/
cp backup_realm.sh backup_users.sh restore_realm.sh restore_users.sh init_settings.sh tmp/
cp -r themes tmp/
cp -r backup_initial_settings tmp/

sed -i 's/\r//' tmp/backup_realm.sh tmp/backup_users.sh tmp/restore_realm.sh tmp/restore_users.sh tmp/init_settings.sh tmp/install.sh
chmod +x tmp/install.sh

makeself tmp "keycloak_$version.run" "Installing Keycloak $version" ./install.sh

echo "Done: keycloak_$version.run"
