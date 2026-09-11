# syntax=docker/dockerfile:1
# The model gateway (the brain). Build from the REPO ROOT (the uv workspace is the context):
#   docker build -f services/gateway/Dockerfile -t wobo-gateway .
# Railway is the only host (DEPLOY.md §2); it builds this file and injects PORT.
# Secrets NEVER bake into this image — everything arrives via environment at runtime.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0
WORKDIR /app

# Manifests first: the third-party dependency layer caches until a manifest changes.
# Every workspace member's pyproject must be present for --frozen to accept the lock.
COPY pyproject.toml uv.lock ./
COPY services/contracts/pyproject.toml services/contracts/
COPY services/verifier/pyproject.toml services/verifier/
COPY services/gateway/pyproject.toml services/gateway/
COPY content/atom/pyproject.toml content/atom/
RUN uv sync --frozen --no-dev --no-editable --no-install-workspace --package wobo-gateway

# Sources second: a code change only rebuilds the small workspace wheels.
COPY services/contracts/src services/contracts/src
COPY services/verifier/src services/verifier/src
COPY services/gateway/src services/gateway/src
RUN uv sync --frozen --no-dev --no-editable --package wobo-gateway

FROM python:3.12-slim-bookworm
RUN useradd --create-home --uid 10001 gateway
WORKDIR /app
COPY --from=build --chown=gateway:gateway /app/.venv /app/.venv

# Read-only content the gateway needs at RUNTIME. Without these two files the concept
# registry falls back to pure derivation and the correctness fact-check gate silently
# no-ops in production (both are written to degrade quietly when the data is absent),
# so they must ship in the image, not just exist in the repo.
#   content/catalogs/concepts.json  -> plexus/store.py   (concept-id overrides)
#   content/factbase/facts.v*.jsonl -> plexus/factcheck.py (verified-fact gate)
# Only these two paths are copied; the rest of content/catalogs is board data the WEB app
# imports at build time and the gateway never reads.
COPY --chown=gateway:gateway content/catalogs/concepts.json /app/content/catalogs/
COPY --chown=gateway:gateway content/factbase/facts.v1.jsonl /app/content/factbase/
#   content/hospitality/festivals.json -> hospitality/festivals.py (the festival wishes;
#   absent, the rule engine sends nothing and says so in the log)
COPY --chown=gateway:gateway content/hospitality/festivals.json /app/content/hospitality/
#   docs/copy/help-centre/**, docs/copy/about.md -> ask_public.py (the public Ask Wobo's
#   grounded index; absent, every question gets the honest 'I don't know that one' line)
COPY --chown=gateway:gateway docs/copy/help-centre /app/content/copy/help-centre
COPY --chown=gateway:gateway docs/copy/about.md /app/content/copy/

# The package is installed NON-EDITABLE, so it lives under /app/.venv/lib/... — relative
# path discovery from __file__ would walk up inside the venv, not to /app. These two
# env overrides (the same ones both modules already honour) point at the copies above,
# so discovery is explicit instead of depending on the install layout.
# THE CACHE LIVES ON A DISK, NOT IN THE CONTAINER (docs/CACHES.md: "the database is the truth
# when the container is new"). It used to be /home/gateway/cache — the image's own writable layer —
# so every deploy discarded every concept core (about USD 0.031 each), every level rendering,
# every interaction design and every generic turn, and the next learner bought them all again.
# /data is where Railway's volume mounts; `store.cache_dir()` also follows RAILWAY_VOLUME_MOUNT_PATH
# on its own, so attaching the volume is the whole of the change on the platform side. The
# directory is created and owned here because a volume mounts onto it and the process that writes
# it is `gateway`, and /healthz reports `persistence.durable: false` while no volume is attached,
# so an image running without one says so rather than quietly costing money.
RUN mkdir -p /data/plexus/images && chown -R gateway:gateway /data
VOLUME ["/data"]
ENV PATH="/app/.venv/bin:$PATH" \
    PLEXUS_CACHE_DIR=/data/plexus \
    WOBO_IMAGE_CACHE_DIR=/data/plexus/images \
    PLEXUS_CONCEPTS_PATH=/app/content/catalogs/concepts.json \
    FACTBASE_DIR=/app/content/factbase \
    WOBO_HOSPITALITY_CONTENT=/app/content/hospitality \
    WOBO_HELP_CONTENT=/app/content/copy
USER gateway
EXPOSE 8081

# Container-level liveness. Railway runs its own HTTP check against /healthz as well
# (railway.json), so an unhealthy container is caught from both sides.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8081') + '/healthz').read()" || exit 1

# Railway injects PORT; 8081 is the local default (and what .env.example's GATEWAY_URL and
# the web app's VITE_GATEWAY_URL point at). --no-access-log: the app emits its own structured
# JSON request lines, uvicorn's plaintext ones would just duplicate.
#
# --forwarded-allow-ips "": uvicorn's own proxy-header middleware would REWRITE the client
# address from X-Forwarded-For whenever the peer is trusted (its default trusts 127.0.0.1),
# and that header is caller-controlled. The rate limiter would then be handing a fresh bucket
# to anyone who rotates a header. One decision in one place instead: uvicorn always reports
# the true peer, and the gateway believes a forwarded hop only under TRUST_PROXY=1
# (app._client_ip), where it takes the LAST hop — the one our own platform appended.
CMD ["sh", "-c", "uvicorn wobo_gateway.app:app --host 0.0.0.0 --port ${PORT:-8081} --no-access-log --forwarded-allow-ips ''"]
