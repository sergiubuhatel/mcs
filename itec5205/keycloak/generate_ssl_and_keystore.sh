#!/bin/bash

echo "### SSL Certificate Generator (Self-Signed) ###"

KEY_FILE="server.key"
CERT_FILE="server.crt"

ORGANIZATION="D-TA"
COUNTRY="CA"
STATE="ON"
LOCALITY="Ottawa"
EMAIL="support@d-ta.com"

read -p "Enter domain Name (e.g., example.com): " COMMON_NAME
read -p "Enter Organization Unit (e.g. MFEL/MRSE): " ORG_UNIT

# Make sure certs directory exists
mkdir -p certs

echo "Generating private key..."
openssl genrsa -out "certs/$KEY_FILE" 2048

echo "Generating certificate signing request (CSR)..."
openssl req -new \
  -key "certs/$KEY_FILE" \
  -out cert.csr \
  -subj "/C=$COUNTRY/ST=$STATE/L=$LOCALITY/O=$ORGANIZATION/OU=$ORG_UNIT/CN=$COMMON_NAME/emailAddress=$EMAIL"

echo "Generating self-signed certificate..."
openssl x509 -req \
  -days 365 \
  -in cert.csr \
  -signkey "certs/$KEY_FILE" \
  -out "certs/$CERT_FILE"

rm -f cert.csr

echo "✅ SSL certificate generated:"
echo " - Private Key: certs/$KEY_FILE"
echo " - Certificate: certs/$CERT_FILE"

echo "Generating Keystore..."

openssl pkcs12 -export \
  -inkey certs/server.key \
  -in certs/server.crt \
  -out temp-keystore.p12 \
  -name keycloak \
  -password pass:Keycloak

keytool -importkeystore \
  -srckeystore temp-keystore.p12 \
  -srcstoretype PKCS12 \
  -destkeystore keycloak.keystore.jks \
  -deststoretype JKS \
  -srcstorepass Keycloak \
  -deststorepass Keycloak \
  -noprompt

rm -f temp-keystore.p12

echo "✅ Keystore generated:"
echo " - keycloak.keystore.jks"