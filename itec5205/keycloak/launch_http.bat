docker run -p 9091:8080 ^
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin ^
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin ^
  -v C:\development\mrse_trunk\keycloak\keycloak-data-http:/opt/keycloak/data ^
  quay.io/keycloak/keycloak:26.2.3 start-dev