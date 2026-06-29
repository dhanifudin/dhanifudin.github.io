---
title: "Containers and Docker — a practical primer for developers"
date: 2026-06-28
description: "From zero to a working Dockerized service with Compose: what containers solve, how Docker works, and the patterns that keep your images lean and secure."
tags: ["docker", "containers", "cloud", "devops"]
draft: false
---

## Why containers matter

Every developer knows the pain: _"It works on my machine."_ You install Node 18, your colleague
has Node 20, CI runs Node 22, and production is on a different distro entirely. Language-specific
version managers — `nvm`, `pyenv`, `rbenv`, `sdkman` — help, but they only solve one axis. What
about system libraries, C compilers, CA certificates, or the fact that your macOS `sed` isn't GNU `sed`?

Virtual machines fix this by packaging an entire OS. But VMs are **heavy**: gigabyte disk images,
minute-long boot times, and a fixed chunk of RAM carved out of your host. Running five
microservices in VMs on a developer laptop is a non-starter.

**Containers** sit in the sweet spot. They share the host kernel but isolate userspace — filesystem,
process tree, network stack — giving you VM-like isolation with near-native performance. A container
starts in under a second and is measured in megabytes, not gigabytes. The result: reproducible
environments from development to production, with no "works on my machine" asterisks.

## Docker core concepts

Docker is the most widely adopted container runtime. It builds on a few simple abstractions:

### Images and containers

An **image** is a read-only template — a filesystem snapshot plus metadata (environment variables,
default command, exposed ports). An image doesn't run; it's a blueprint.

A **container** is a running instance of an image. You can spin up a hundred containers from the
same image; each gets its own writable layer, so changes in one don't bleed into another.

Think of an image as a **class** and a container as an **object**.

### Layers and caching

Images are built from layers. Each instruction in a Dockerfile — `FROM`, `RUN`, `COPY`, `ADD` —
creates a new layer stacked on top of the previous one. Layers are content-addressed and cached:
if a layer hasn't changed, Docker reuses it from cache instead of rebuilding. This is why
ordering matters. We'll come back to that.

### Registries

Images are stored in registries. `docker pull golang:1.22` fetches the image from
**Docker Hub**, the default public registry. Private registries — Amazon ECR, Google Artifact
Registry, GitHub Container Registry — host your own images. A registry stores tagged images;
`myapp:v1.2.3` is just a human-friendly alias for a content hash.

### The Dockerfile instruction model

A Dockerfile is a linear script of instructions. The key ones:

| Instruction | Purpose |
|-------------|---------|
| `FROM` | Base image (or stage, for multi-stage builds) |
| `WORKDIR` | Set working directory for subsequent instructions |
| `COPY` | Copy files from the build context into the image |
| `RUN` | Execute a command during build (e.g. `apt-get`, `go build`) |
| `ENV` | Set an environment variable |
| `EXPOSE` | Document a port (informational; doesn't publish) |
| `CMD` | Default command when the container starts |
| `ENTRYPOINT` | Executable that receives `CMD` as arguments |

## A real-world example — Go API with multi-stage builds

(If you don't have a Go API yet, follow the [Go REST API tutorial](/blog/building-rest-apis-with-go)
to build one — then come back here to containerise it.)

Let's build an image for a small Go REST API. A naive Dockerfile copies the source, installs Go,
compiles, and ships everything — including the entire Go toolchain. The result? A 900 MB image
serving a 10 MB binary.

Multi-stage builds eliminate this bloat. Stage 1 has the compiler; stage 2 copies out only what
you need to run.

```dockerfile
# Stage 1: build
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/server ./cmd/api

# Stage 2: runtime
FROM scratch

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/server /server

EXPOSE 8080
ENTRYPOINT ["/server"]
```

What's happening here:

1. **`FROM ... AS builder`** names the first stage. We install `ca-certificates` for TLS, copy
   `go.mod`/`go.sum` first (layer caching — dependencies change less often than source), run
   `go mod download`, then copy the rest of the code and build a statically linked binary.
   `-ldflags="-s -w"` strips debug info, shaving a few MB.

2. **`FROM scratch`** is the smallest possible base — literally zero bytes. We copy only the
   compiled binary and CA certificates from the builder stage. The final image is roughly 8 MB.

3. **`ENTRYPOINT`** uses exec form (JSON array) so the binary receives signals properly.
   Shell form (`ENTRYPOINT /server`) wraps it in `sh -c`, which breaks signal forwarding and makes
   the shell PID 1.

Build and run it:

```bash
docker build -t myapi:latest .
docker run --rm -p 8080:8080 myapi:latest
```

## Local development with Compose

Real applications rarely run in isolation. Your API probably talks to PostgreSQL or Redis,
and maybe depends on a local S3 emulator. Spinning each up with manual `docker run` commands
and a custom network is tedious.

**Docker Compose** lets you declare the whole stack in one file:

```yaml
version: "3.9"

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/app?sslmode=disable
      REDIS_URL: redis://cache:6379/0
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    volumes:
      - .:/app
    command: air --build.cmd "go build -o /tmp/server ./cmd/api" --build.bin "/tmp/server"

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 3s
      retries: 5

  cache:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

Key details:

- **`depends_on` with `condition: service_healthy`** ensures the API doesn't start until Postgres
  passes its readiness check. Without the `condition`, Compose only waits for the container to
  start — not for the database to accept connections.

- **The `volumes` mount** maps the project directory into the container, enabling hot reload
  with [Air](https://github.com/air-verse/air). You edit code on the host; the container rebuilds
  and restarts instantly.

- **Named volumes** (`pgdata`) persist database data across `docker compose down`. Without it,
  destroying the container nukes your dev database.

Start everything with:

```bash
docker compose up --build
```

## Common pitfalls and best practices

### 1. Order layers for cache efficiency

`COPY . .` is the most expensive line in your Dockerfile — it invalidates the cache whenever
any file changes. Put it as late as possible, after dependency installation:

```dockerfile
# Good: dependencies cached until go.mod/go.sum change
COPY go.mod go.sum ./
RUN go mod download
COPY . .

# Bad: everything re-downloads on every source change
COPY . .
RUN go mod download
```

### 2. Use `.dockerignore`

Docker sends the entire build context (often your project root) to the daemon before building.
Without `.dockerignore`, you're uploading `node_modules/`, `.git/`, and local binaries — slowing
builds and risking layer cache misses. A minimal `.dockerignore`:

```
.git
node_modules
*.log
.env
dist
```

### 3. Run as a non-root user

By default, your process runs as `root` inside the container. If an attacker escapes to the host,
they land as root there too. Add a dedicated user in the runtime stage:

```dockerfile
FROM alpine:3.20
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app/server /server
USER appuser
ENTRYPOINT ["/server"]
```

For scratch-based images, include `/etc/passwd`:

```dockerfile
FROM scratch
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /app/server /server
USER appuser
ENTRYPOINT ["/server"]
```

### 4. Add health checks

Without a health check, Docker doesn't know if your container is healthy or just running.
Add a `HEALTHCHECK` instruction so orchestrators (Compose, Kubernetes, Swarm) can make routing
and restart decisions:

```dockerfile
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1
```

### 5. Keep images small

Small images pull faster, start faster, and have a smaller attack surface. A quick checklist:

- Prefer `alpine` variants over `debian` when you can.
- Use `--no-install-recommends` with `apt-get` to skip optional packages.
- Clean package manager caches in the same `RUN` layer: `apt-get update && apt-get install ... && rm -rf /var/lib/apt/lists/*`
- Use multi-stage builds — never ship a compiler in your production image.
- Run `docker image prune` periodically to reclaim disk space from dangling layers.

### 6. Pin versions, never use `latest`

`FROM golang:latest` is a moving target. A CI build that succeeds today may break tomorrow when
`latest` points to a new major version. Pin explicitly: `FROM golang:1.22-alpine`.

## Where to go next

Docker is the gateway, not the destination. Once you're comfortable with images, containers, and
Compose, the natural next steps build on these foundations:

- **Kubernetes** — orchestrates containers across clusters. Your Compose file is a single-host
  playbook; Kubernetes does the same thing scaled across dozens of nodes.

- **CI/CD image pipelines** — automate Docker builds in GitHub Actions, GitLab CI, or Jenkins.
  Tag images with commit SHAs and semver, push to a registry, and deploy on merge to main.

- **Registry strategies** — decide where your images live (Docker Hub, ECR, GCR, GHCR) and how
  you scan them for vulnerabilities. Tools like [Trivy](https://github.com/aquasecurity/trivy)
  and [Docker Scout](https://docs.docker.com/scout/) plug into CI to catch CVEs before they
  reach production.

- **Distroless and Chainguard images** — go even smaller than `alpine` with images that contain
  only your application and its runtime dependencies, no shell, no package manager.

If you're building cloud-native services, Docker is the first skill to learn — and the one
you'll keep using every day. Start with these patterns, and the rest builds naturally.
