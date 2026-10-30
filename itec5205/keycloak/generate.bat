openssl pkcs12 -export ^
  -inkey certs/server.key ^
  -in certs/server.crt ^
  -out temp-keystore.p12 ^
  -name keycloak ^
  -password pass:Keycloak

keytool -importkeystore ^
  -srckeystore temp-keystore.p12 ^
  -srcstoretype PKCS12 ^
  -destkeystore keycloak.keystore.jks ^
  -deststoretype JKS ^
  -srcstorepass Keycloak ^
  -deststorepass Keycloak
