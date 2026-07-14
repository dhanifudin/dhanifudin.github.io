---
title: "CI/CD pipelines with GitHub Actions — from git push to running pods"
date: 2026-07-07
description: "Close the loop: automate Go API builds, Docker image pushes to GHCR, vulnerability scans with Trivy, and Kubernetes deployments with a single GitHub Actions workflow."
tags: ["github-actions", "ci-cd", "devops", "cloud", "kubernetes"]
series:
  id: from-go-api-to-kubernetes
  name: "From Go API to Kubernetes"
  order: 5
  description: "A practical progression from building REST APIs in Go through containerization with Docker to orchestration with Kubernetes."
draft: false
---

## Why automate the path from commit to cluster

In the [Go REST API tutorial](/blog/building-rest-apis-with-go) we built an API from
`net/http` to structured handlers. The [Docker primer](/blog/containers-and-docker) packaged
it into an 8 MB image with multi-stage builds. The [Kubernetes tutorial](/blog/kubernetes-for-developers)
deployed it to a kind cluster with Deployments, Services, ConfigMaps, rolling
updates, and zero-downtime restarts.

At this point the series covers the _what_ and _why_ of each layer. What it doesn't
cover yet is the _how often_. Every code change still requires you to:

1. Run `go test ./...` locally
2. Run `docker build -t myapi:latest .`
3. Run `docker push` to a registry
4. Run `kubectl set image deployment/api api=myapi:latest`
5. Wait, hope, and check logs

That's fine for exploration. It breaks down the moment more than one person touches
the repo, or when you push at 11 PM and forget step 4, or when the image you built
on your laptop has a different `libc` than the one that works in the cluster.

**CI/CD** is the answer. It's the automated pipeline that runs on every push — builds,
tests, scans, pushes, and deploys — so the only manual step left is `git push`. This
tutorial builds that pipeline with GitHub Actions, the CI/CD system built into every
GitHub repository, and connects it to the Go API + Docker + Kubernetes stack we've
assembled across the series.

## What a minimal CI/CD loop looks like

Before writing YAML, it helps to draw the loop as a sequence of gates. Each gate
must pass before the change can reach production:

```
git push (main or PR)
     │
     ▼
┌─────────────┐
│  Lint & Test │  ← catch regressions before anything else
└──────┬──────┘
       │ ✅
       ▼
┌─────────────┐
│ Build image  │  ← compile the Go binary inside Docker
└──────┬──────┘
       │ ✅
       ▼
┌─────────────┐
│ Scan image   │  ← check for known CVEs (Trivy)
└──────┬──────┘
       │ ✅
       ▼
┌─────────────┐
│ Push to GHCR │  ← tag with commit SHA and `latest`
└──────┬──────┘
       │ ✅
       ▼
┌─────────────┐
│ Deploy to K8s│  ← `kubectl set image` or `kubectl apply`
└──────┬──────┘
       │ ✅
       ▼
   🎉 Running pods
```

The first two gates — lint/test and build — run on every push and every pull request.
The scan gate runs on push to main and on PRs. The push and deploy gates only run on
pushes to main — you don't want every feature branch updating the cluster.

This is sometimes called **CI/CD** semantics — _continuous integration_ (every push
is tested and merged) plus _continuous delivery_ (merged code is automatically
deployed). Some teams add a manual approval gate before deploy (_continuous
deployment_ vs _continuous delivery_), but for a personal project or staging
environment, full automation from merge to cluster is both safe and liberating.

## Repository layout after the series

Let's be concrete about what files exist in the repo after following the first
three tutorials. The CI/CD workflow needs to know these paths:

```
.
├── .github/
│   └── workflows/
│       └── ci-cd.yaml          ← we're creating this
├── cmd/
│   └── api/
│       └── main.go             ← entry point
├── internal/
│   ├── handlers/
│   ├── middleware/
│   └── store/
├── Dockerfile                  ← multi-stage (go build → scratch)
├── docker-compose.yml
├── go.mod
├── go.sum
├── manifests/                  ← Kubernetes manifests from tutorial 3
│   ├── api.yaml                ← Deployment + Service
│   ├── api-config.yaml         ← ConfigMap
│   ├── api-secret.yaml         ← Secret
│   ├── postgres.yaml           ← Postgres Deployment
│   ├── postgres-svc.yaml       ← Postgres Service
│   └── redis.yaml              ← Redis Deployment + Service
└── Makefile                    ← optional but convenient
```

The Go module is `github.com/dhanifudin/go-api-demo`. The Docker image will live
at `ghcr.io/dhanifudin/go-api-demo`. If your repo uses a different name, substitute
throughout.

## GitHub Actions workflow anatomy

Every GitHub Actions workflow is a YAML file under `.github/workflows/`. GitHub
scans this directory and registers each file as a pipeline.

The anatomy:

```yaml
name: CI/CD                    # displayed in the Actions tab

on:                            # trigger: when does this run?
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:                          # independent units of work
  test:                        # job name
    runs-on: ubuntu-latest     # VM image (Linux, macOS, or Windows)
    steps:                     # sequential steps inside this job
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.22"
      - run: go test ./...
```

Key concepts:

- **Trigger** (`on`): defines when the workflow runs. Common triggers are `push`,
  `pull_request`, `schedule` (cron), and `workflow_dispatch` (manual button).
- **Job**: a group of steps that run on the same runner. Jobs are independent
  and parallel by default; you can chain them with `needs`.
- **Step**: either a shell command (`run`) or a reusable action (`uses`).
  Actions are the npm packages of CI/CD — community-maintained building blocks.
- **Runner**: the VM that executes jobs. `ubuntu-latest` is the most common choice,
  but `windows-latest` and `macos-latest` are available.

For our pipeline, we'll define four jobs — test, build-and-push, scan, and deploy —
with dependencies between them so nothing runs out of order.

## The complete workflow

Below is the full `.github/workflows/ci-cd.yaml`. Copy it into your repo, set up
the secrets described in the next sections, push, and watch the pipeline go green.

```yaml
name: CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ─── Job 1: Lint and test ───────────────────────────────────────────────
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: "1.22"
          cache: true

      - name: Verify module dependencies
        run: go mod verify

      - name: Vet
        run: go vet ./...

      - name: Test
        run: go test -race -coverprofile=coverage.out ./...

      - name: Upload coverage
        if: github.event_name == 'push'
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage.out

  # ─── Job 2: Build and push Docker image ─────────────────────────────────
  build-and-push:
    name: Build & Push
    runs-on: ubuntu-latest
    needs: test
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata for Docker
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=,format=short
            type=ref,event=branch
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ─── Job 3: Vulnerability scan with Trivy ───────────────────────────────
  scan:
    name: Scan
    runs-on: ubuntu-latest
    needs: build-and-push
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    permissions:
      contents: read
      packages: read
      security-events: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
          format: sarif
          output: trivy-results.sarif
          severity: HIGH,CRITICAL

      - name: Upload Trivy results to GitHub Security tab
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: trivy-results.sarif

  # ─── Job 4: Deploy to Kubernetes ────────────────────────────────────────
  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    needs: scan
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure kubectl
        uses: azure/setup-kubectl@v4
        with:
          version: v1.31

      - name: Set kubeconfig
        run: |
          mkdir -p $HOME/.kube
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > $HOME/.kube/config

      - name: Update image tag in Deployment
        run: |
          kubectl set image deployment/api \
            api=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest \
            --namespace=default \
            --record

      - name: Verify rollout
        run: |
          kubectl rollout status deployment/api --namespace=default --timeout=120s
          kubectl get pods -l app=api -o wide
```

## Walkthrough: what each section does

### Job 1 — Test

The test job catches regressions before we spend cycles on a Docker build. It
runs on every push to main and every pull request.

`go mod verify` confirms that the module cache hasn't been tampered with.
`go vet` is Go's static analyser — it catches things like unreachable code,
incorrect format strings, and suspicious constructs that the compiler doesn't
flag. `go test -race -coverprofile=coverage.out ./...` runs all tests in all
packages, enables the race detector (adds overhead but catches data races early),
and writes a coverage profile.

The coverage artifact is uploaded on push events only. You can pull it into
tools like [codecov](https://about.codecov.io/) or analyse it in PR comments
with a coverage-diff action.

### Job 2 — Build & Push

This job depends on `test` passing. If `go test` fails, the Docker build
never starts — saving runner minutes and avoiding a broken image.

**Set up Docker Buildx** enables the BuildKit engine, which supports multi-platform
builds, cache backends, and better layer caching. The `gha` cache type stores
build layers in GitHub Actions' own cache, so subsequent builds only re-run
the layers that changed — similar to how local `docker build` uses its layer
cache, but shared across workflow runs.

**Log in to GHCR** uses `secrets.GITHUB_TOKEN` — a token that GitHub generates
automatically for every workflow run. It has read/write access to the repository's
packages but expires when the job finishes. No additional secret configuration
is needed; the `packages: write` permission on the job is enough.

**Extract metadata** generates tags and labels from Git context. The `tags`
block produces:

| Pattern | Example output | When |
|---------|---------------|------|
| `type=sha,format=short` | `abc1234` | every build |
| `type=ref,event=branch` | `main` | push to main |
| `type=raw,value=latest` | `latest` | push to main only |

This gives you three tags on every main push: `abc1234`, `main`, and `latest`.
The short SHA is immutable — you can roll back to it weeks later. The `latest`
tag floats to the most recent image, which makes it convenient for deployment
(no need to update a version string in your manifests).

**Build and push** uses `docker/build-push-action` with a conditional `push`
flag. On pull requests, the image is built (validating the Dockerfile) but
not pushed. On push to main, it builds _and_ pushes. The `cache-from` and
`cache-to` directives wire up the GitHub Actions cache so the Go module
download layer and the `go build` layer only invalidate when their inputs
change.

### Job 3 — Scan

Scanning is the seatbelt between "image built" and "image deployed." Trivy
is an open-source vulnerability scanner from Aqua Security that reads a container
image's filesystem and installed packages, then cross-references them against
public CVE databases. It catches things like:

- A vulnerable version of `libc` in the runtime layer
- An outdated CA certificates bundle
- Go standard library CVEs (even statically linked, because Trivy scans the
  Go binary itself)

The scan job runs only on pushes to main (scanning PR images is possible but
adds cost; for a personal project, scanning main is a pragmatic balance).
If Trivy finds HIGH or CRITICAL vulnerabilities, the SARIF report is uploaded
to the repository's **Security** tab, where you can triage and track them
over time.

Note that this job doesn't block deployment by default — it reports findings
to the Security tab without failing the pipeline. To make scanning a hard gate,
add `exit-code: 1` and `severity: HIGH,CRITICAL` to the trivy-action inputs
and remove `if: always()` from the upload step.

### Job 4 — Deploy

The deploy job wires the GitHub Actions runner to your Kubernetes cluster and
updates the running `api` Deployment.

**Configure kubectl** installs the `kubectl` CLI (v1.31). Pin the version to
match your cluster's control plane — a version skew of ±1 minor is supported,
but matching exactly avoids surprises.

**Set kubeconfig** decodes the `KUBE_CONFIG` secret and writes it to the
standard location (`~/.kube/config`). The secret must contain the base64-encoded
contents of a kubeconfig file with credentials for the target cluster. See the
next section for how to create it.

**Update image tag** runs `kubectl set image` on the `api` Deployment, pointing
the `api` container to the freshly built image at `ghcr.io/dhanifudin/go-api-demo:latest`.
The `--record` flag annotates the Deployment with the command that triggered
the change, visible in `kubectl rollout history`.

**Verify rollout** waits up to 120 seconds for the rollout to complete. If the
new Pods fail readiness probes or crash-loop, `kubectl rollout status` exits
with a non-zero code, the job fails, and you get a notification. The `kubectl
get pods` output gives you a snapshot of what's running — useful for debugging
directly in the Actions log.

### Why `kubectl set image` and not `kubectl apply`

You might wonder why we use `kubectl set image` instead of updating `manifests/api.yaml`
and running `kubectl apply`. Both work. The difference is:

- **`kubectl set image`** is an imperative command that reaches into the cluster
  and mutates one field. It's simple, it's fast, and it doesn't require you to
  keep the image tag in sync between the workflow and the manifest file. The
  downside: the cluster state drifts from what's in Git. If someone runs
  `kubectl apply -f manifests/api.yaml` later, it reverts the image tag.

- **`kubectl apply`** is declarative. You update `manifests/api.yaml` to reference
  the new tag, commit that change, and let the workflow `kubectl apply` the
  manifest. The cluster always matches Git. The downside: you need a step that
  edits the manifest (e.g. `sed` or `yq`) before applying, and you end up with
  a commit-per-deploy in your Git history.

For a small project, `kubectl set image` is the pragmatic choice. As you scale,
the declarative path — codified by GitOps tools like Argo CD and Flux — becomes
the cleaner approach. See the GitOps section below.

## Creating secrets

The workflow needs two secrets configured in your repository. Go to
**Settings → Secrets and variables → Actions → New repository secret**.

### `GITHUB_TOKEN` — no setup needed

`secrets.GITHUB_TOKEN` is automatically injected by GitHub into every workflow
run. You don't create it manually. It authenticates the workflow to GitHub's API
and to the GitHub Container Registry. The permissions it carries are scoped by
the `permissions` block in the workflow file, not by a manual token.

For this workflow, the build-and-push job declares `packages: write`, which
allows pushing images to GHCR. The scan job adds `security-events: write` for
uploading SARIF reports. No other secrets are needed for the registry.

### `KUBE_CONFIG` — one manual secret

The `KUBE_CONFIG` secret contains the base64-encoded kubeconfig file for your
cluster. Generate it from a machine that already has `kubectl` access:

```bash
# Encode your kubeconfig to base64 (macOS/Linux)
cat ~/.kube/config | base64 | tr -d '\n'
```

Copy the entire output — it will be a long, single-line string — and paste it
as the value of the `KUBE_CONFIG` secret.

**Important:** The kubeconfig embeds credentials (client certificate, token, or
username/password). Treat the secret like a password. Rotate cluster credentials
periodically and update the secret.

#### For kind clusters (local testing)

If you're using a local kind cluster for development, the GitHub Actions runner
can't reach it — `ubuntu-latest` runs in GitHub's cloud, not on your machine. For
local testing, you have two options:

- **Install a self-hosted runner** on a machine inside your network that has
  access to the kind cluster.
- **Use a cloud Kubernetes cluster** for the "deploy on push" workflow. For
  learning, any managed Kubernetes service (GKE, EKS, AKS, DigitalOcean
  Kubernetes) works and gives you a stable endpoint reachable from GitHub's
  runners.

For this tutorial, we assume a cluster reachable from the internet — a managed
K8s service or a VPS running k3s with a public IP.

## Environments and deployment protection

GitHub Actions supports **environments** — named deployment targets (e.g.
`staging`, `production`) with optional protection rules. Adding an environment
to the deploy job gives you:

- **Required reviewers** — one or more people must approve before the job runs.
- **Wait timer** — a mandatory delay (e.g. 5 minutes) before deployment.
- **Environment-specific secrets** — `KUBE_CONFIG` could be different for
  `staging` and `production`.

To add an environment, create it under **Settings → Environments**, then
reference it in the workflow:

```yaml
deploy:
  environment: production
```

This is optional for a personal project, but it's a good habit to set up — it
costs nothing and prevents accidental deploys.

## Triggering on tags

If you prefer semantic versioning over floating `latest` tags, add a tag trigger
that builds and pushes a versioned image:

```yaml
on:
  push:
    branches: [main]
    tags: ["v*"]
```

Then update the `tags` block in the metadata step:

```yaml
tags: |
  type=sha,prefix=,format=short
  type=ref,event=branch
  type=ref,event=tag
  type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}
```

Now `git tag v1.0.0 && git push --tags` produces `ghcr.io/dhanifudin/go-api-demo:v1.0.0`.
Combine this with `kubectl set image` using the tag instead of `latest`, and you
get immutable, versioned deployments.

## Moving toward GitOps

`kubectl set image` from a CI runner is effective but it has a philosophical
gap: the CI system has write access to both the image registry _and_ the
cluster. In larger teams, the cluster is a separate trust domain — you want CI
to push images, but a different system to decide _when_ and _what_ to deploy.

**GitOps** separates these concerns. The core idea:

```
Developer pushes code
       │
       ▼
CI builds image, pushes to GHCR ───┐
                                   │
Developer (or CI) updates          │
a Git repo with the new image tag  │
       │                           │
       ▼                           │
GitOps controller (Argo CD / Flux) │
watches the Git repo ──────────────┘
       │
       ▼
Controller reconciles cluster
to match Git state
```

The Git repo becomes the single source of truth for _what runs_. The controller
continuously polls the repo and applies any drift. If someone manually edits a
Deployment, the controller reverts it. If a new image tag appears, the controller
rolls it out.

### Argo CD

Argo CD is a Kubernetes-native GitOps tool with a web UI and CLI. It watches a
Git repository (or a Helm chart, or a Kustomize overlay) and syncs the cluster
to match. The deployment manifests live in a separate repo (or a separate path
in the same repo), and Argo CD handles the apply loop.

The workflow above would change: instead of a `deploy` job that runs `kubectl`,
you'd push the image, then either manually update the image tag in the GitOps
repo or have a CI job that commits the tag update. Argo CD picks up the change
and rolls it out.

### Flux

Flux is the CNCF-graduated alternative. It takes the same approach — a
controller inside the cluster that watches a Git repo — but adds automated
image updates: Flux can watch a container registry, detect new tags, and
commit the update back to the GitOps repo.

The advantage: you don't need a separate CI step to update manifests. Flux's
image automation controller does it for you.

Both Argo CD and Flux are beyond the scope of this single tutorial, but the
pipeline we've built here — CI builds, tests, and pushes — is the first half
of the GitOps equation. The second half is picking a controller and pointing
it at a repo.

## Troubleshooting common failures

### `go vet` or `go test` fails in CI but passes locally

The GitHub Actions runner is a fresh VM with no local state. Common causes:

- **Missing `go.sum` entries.** Run `go mod tidy` locally and commit the
  updated `go.sum`.
- **File system case sensitivity.** macOS is case-insensitive by default;
  `ubuntu-latest` is case-sensitive. Import paths must match directory names
  exactly.
- **Environment-dependent tests.** Tests that read from `os.Getenv("DATABASE_URL")`
  and don't have a default will panic. Add sensible defaults or use `t.Setenv`.

### Docker build fails with "COPY failed: file not found"

The `context: .` in the build step means the Dockerfile has access to the repo
root. If your Dockerfile references `./cmd/api` and the path is different
(e.g. `./cmd/server`), the build will fail. Match the `file:` and `context:`
to your actual layout.

### `kubectl set image` fails with "the server doesn't have a resource type"

The `api` Deployment doesn't exist on the cluster. Run `kubectl apply -f
manifests/api.yaml` once manually (or add it to the workflow as an initial
setup step). The `set image` command mutates an existing Deployment; it
doesn't create one.

### `kubectl rollout status` times out

The new Pods aren't becoming ready. Common culprits:

- **Image pull error.** The cluster can't pull from GHCR. For a public repo,
  GHCR images are public by default. For a private repo, you need an
  `imagePullSecret` in the Deployment spec.
- **Readiness probe fails.** The `/health` endpoint isn't returning 200. Check
  the pod logs: `kubectl logs deployment/api`.
- **CrashLoopBackOff.** The binary panics on startup. Check whether
  environment variables (`DATABASE_URL`, `REDIS_URL`) are set correctly in
  the cluster's ConfigMap and Secret.

## Where to go next

This tutorial closes the loop from `git push` to running Pods, completing the
"From Go API to Kubernetes" series. The pipeline we built covers the essential
gates — test, build, scan, deploy — and gives you a foundation to extend.

- **Helm** — replace raw manifests with a Helm chart. Package the Go API, Postgres,
  and Redis into a single `values.yaml` with templated resources. Helm handles
  upgrades, rollbacks, and release history.

- **GitOps with Argo CD or Flux** — decouple CI from CD. Let a controller inside
  the cluster watch your manifests repo and reconcile continuously. See the
  [GitOps section](#moving-toward-gitops) above for the architecture.

- **Observability** — add Prometheus metrics to the Go API (via
  [promhttp](https://pkg.go.dev/github.com/prometheus/client_golang/prometheus/promhttp)),
  collect them with the Prometheus Operator, visualize with Grafana, and
  aggregate logs with Loki. The `kubectl logs` workflow step you added is a
  starting point; a full stack gives you dashboards and alerts.

- **Multi-environment pipelines** — extend the workflow with a `staging` and
  `production` environment. Use environment-specific secrets and a manual
  approval gate between them. The `environments` feature in GitHub Actions
  makes this straightforward.

- **Infrastructure as Code** — if your Kubernetes cluster itself is defined
  in Terraform or Pulumi (EKS, GKE, AKS), the CI pipeline can also run
  `terraform plan` on PRs and `terraform apply` on merge. The same repo can
  hold both the application and the infrastructure that runs it.

The pipeline you've built today is the automation layer that turns a collection
of YAML files into a living system. Every push to main rebuilds, rescans, and
redeploys — and you can watch it all happen in the Actions tab. That's the
engineering loop: write code, push, and trust the pipeline.
