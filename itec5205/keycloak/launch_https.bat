docker run -p 9090:8443 ^
 --name keycloak-https ^
 -e KC_HOSTNAME=192.168.0.105 ^
 -e KC_HOSTNAME_STRICT=false ^
 -e KC_HOSTNAME_STRICT_HTTPS=false ^
 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin ^
 -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin ^
 -v C:\development\mrse_trunk\keycloak\keycloak-data:/opt/keycloak/data ^
 -v C:\development\mrse_trunk\keycloak:/etc/x509/https:ro ^
 quay.io/keycloak/keycloak:26.2.3 start ^
 --https-key-store-file=/etc/x509/https/keycloak.keystore.jks ^
 --https-key-store-password=Keycloak
