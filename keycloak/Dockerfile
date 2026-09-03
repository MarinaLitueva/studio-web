# Constructor Studio — custom Keycloak image.
# The image contains only the optimized Keycloak runtime. Environment realms
# and every credential are supplied at runtime; a public image must never carry
# a usable bootstrap realm or client secret.
ARG KEYCLOAK_IMAGE=quay.io/keycloak/keycloak:26.7@sha256:ff4257d0d64efbe99ed1ddfaf07765cc3c36dc7518bf8324d41961327f441c54

# ---- Constructor Studio authentication provider ----
FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS extension-builder
WORKDIR /build
COPY extensions/github-org-authenticator/pom.xml ./pom.xml
RUN mvn --batch-mode dependency:go-offline
COPY extensions/github-org-authenticator/src ./src
RUN mvn --batch-mode verify

# ---- optimized build stage ----
FROM ${KEYCLOAK_IMAGE} AS builder
ENV KC_DB=postgres
ENV KC_HEALTH_ENABLED=true
ENV KC_METRICS_ENABLED=true
ENV KC_VAULT=file
ENV KC_HTTP_RELATIVE_PATH=/auth
ENV KC_HTTP_MANAGEMENT_RELATIVE_PATH=/
COPY --from=extension-builder \
  /build/target/github-org-authenticator-1.0.0.jar \
  /opt/keycloak/providers/github-org-authenticator.jar
RUN /opt/keycloak/bin/kc.sh build

# ---- runtime stage ----
FROM ${KEYCLOAK_IMAGE}
COPY --from=builder /opt/keycloak/ /opt/keycloak/
# Files-plaintext vault: secrets live in files at KC_VAULT_DIR (mounted Secret),
# referenced by the runtime realm mounted by the deployment.
ENV KC_VAULT=file
ENV KC_VAULT_DIR=/opt/keycloak/data/vault
# The realm JSON, hostname, proxy, DB connection and bootstrap admin are all
# supplied at runtime by the Helm chart and existing Kubernetes Secrets.
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
