#!/bin/bash

CERT_DIR="/etc/ssl/certs/keycloak"

echo "### Keystore Setup ###"
echo "Using keystore from: $CERT_DIR"

if [ ! -f "$CERT_DIR/keycloak.keystore.jks" ]; then
    echo "ERROR: $CERT_DIR/keycloak.keystore.jks not found."
    exit 1
fi

cp "$CERT_DIR/keycloak.keystore.jks" ./keycloak.keystore.jks

echo "Done: keycloak.keystore.jks"
