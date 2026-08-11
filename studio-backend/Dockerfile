# Runtime image for the Studio backend.
# The binary is built in CI (release.yml, backend-binary job) and placed at
# .release/studio-backend before `docker build` — compiling the 90-crate
# gears workspace inside a Dockerfile would need the sibling gears-rust
# checkout in the build context and much longer builds.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 1000 studio \
 && useradd --system --uid 1000 --gid 1000 --home /app studio

WORKDIR /app
COPY .release/studio-backend /app/studio-backend
COPY config/ /app/config/
RUN chmod +x /app/studio-backend && chown -R studio:studio /app

# Numeric on purpose: with `runAsNonRoot: true` the kubelet must prove the
# container is non-root BEFORE starting it, and a named USER gives it nothing
# to verify — the pod dies with "image has non-numeric user (studio)".
# 1000 matches Dockerfile.src and the `node` uid in the Theia session image,
# so files this server creates stay writable across the stack.
USER 1000
EXPOSE 8090
# home_dir (SQLite/logs) lives under /app; mount a volume or use the postgres profile.
# Override APP__* env vars or mount your own config for real deployments.
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD curl -sf http://127.0.0.1:8090/healthz || exit 1

ENTRYPOINT ["/app/studio-backend"]
CMD ["--config", "/app/config/dev.yaml", "run"]
