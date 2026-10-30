#!/bin/bash

TARGET_DIR="/opt/dta/keycloak"
CERT_DIR="/etc/ssl/certs/keycloak"

echo "Installing to: $TARGET_DIR"

install -m 755 -d "$TARGET_DIR"

cp docker-compose.yml "$TARGET_DIR/"
cp backup_realm.sh backup_users.sh restore_realm.sh restore_users.sh init_settings.sh "$TARGET_DIR/"
cp -r backup_initial_settings "$TARGET_DIR/"
cp -r themes "$TARGET_DIR/"
cp "$CERT_DIR/keycloak.keystore.jks" "$TARGET_DIR/"

chmod -R 755 "$TARGET_DIR"

echo "Setting SELinux context..."
chcon -Rt container_file_t "$TARGET_DIR"

echo "Restarting Keycloak..."
cd "$TARGET_DIR"
docker compose down
docker compose up -d

echo "Installation complete."
echo "Installed in: $TARGET_DIR"
