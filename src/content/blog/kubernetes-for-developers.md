---
title: "Kubernetes for developers — from Compose to cluster"
date: 2026-06-28
description: "Bridge the gap from Docker Compose to Kubernetes: set up a local cluster with kind, translate Compose services into Deployments and Services, and learn the core objects you need every day."
tags: ["kubernetes", "k8s", "cloud", "devops"]
series:
  id: from-go-api-to-kubernetes
  name: "From Go API to Kubernetes"
  order: 4
  description: "A practical progression from building REST APIs in Go through containerization with Docker to orchestration with Kubernetes."
draft: false
---

## Why Kubernetes after Docker

In the [Go REST API tutorial](/blog/building-rest-apis-with-go) we built an API from scratch,
then [containerised it with Docker](/blog/containers-and-docker), wired it to
PostgreSQL and Redis with Compose, and ran everything on one machine with `docker compose up`.
That workflow carries you through development, but it hits a wall the moment you need more than
one host.

Compose answers _what to run_. It doesn't answer:

- **Which node should run this container?** Compose only knows about one machine.
- **What happens when a container dies?** It stays dead unless you restart it manually.
- **How do I roll out a new version without downtime?** Compose has no notion of rolling updates.
- **How do services discover each other across hosts?** Compose DNS works only within a single
  Docker network on the same daemon.

Kubernetes (K8s) answers all of these. It's a **control loop + desired-state database** that
watches the cluster and continuously reconciles reality toward what you declared. You say _"I
want three replicas of `api` running, listening on port 8080"_ and Kubernetes schedules,
restarts, scales, and load-balances them across a pool of machines.

The learning curve is real, but the concepts map cleanly onto what you already know from Compose.
This tutorial shows you the smallest useful subset — enough to go from `docker compose up` to
`kubectl apply` in one sitting.

## The smallest useful concepts

Kubernetes has 50+ resource types, but you only need five to start shipping:

### Pod

A Pod is the smallest deployable unit — one or more containers that share a network namespace
(localhost-visible), IPC namespace, and optional shared volumes. In practice you almost never
create a bare Pod; you let a higher-level controller do it.

Think of a Pod as an _instance_ of your container, like a single `docker run`.

### Deployment

A Deployment manages a set of identical Pods. You declare a desired replica count and a Pod
template; the Deployment controller creates and maintains ReplicaSets, which in turn own the Pods.
When you update the template (e.g. a new image tag), the Deployment performs a **rolling update** —
gradually replacing old Pods with new ones so the service stays reachable.

This is the Kubernetes equivalent of `docker compose up --scale api=3` with the ability to
update in place without downtime.

### Service

Pods are ephemeral — they get new IPs when they restart. A **Service** gives you a stable IP
and DNS name that load-balances across a set of Pods matching a label selector. When a Pod
comes or goes, the Service's endpoint list updates automatically.

The Compose analogy: a Service is Compose's internal DNS (`api:8080`) but decoupled from
container lifecycle and spanning any node in the cluster.

### ConfigMap and Secret

A **ConfigMap** stores non-sensitive key-value pairs (environment variables, config files).
A **Secret** does the same for credentials, tokens, and keys. Both can be mounted as files
or injected as environment variables. This is how you externalise configuration from your
container images — the Kubernetes equivalent of the `environment` block in a Compose file,
but with the ability to update independently and reference the same values across multiple
Deployments.

### Namespace

A Namespace is a virtual cluster — a scope for names. You can have `api` in `staging` and
`api` in `production` without collision. Resource quotas and RBAC rules apply per-namespace.
For a local dev cluster, the `default` namespace is fine.

## Local cluster with kind

There are several ways to run a local cluster: **minikube**, **k3d**, and **kind** (Kubernetes
IN Docker). We'll use **kind** because it runs the control plane and worker nodes as Docker
containers, needs no VM hypervisor, and works identically on Linux, macOS, and Windows.

### Install the tools

```bash
# kind CLI
# Linux/macOS:
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.24.0/kind-linux-amd64
chmod +x ./kind && sudo mv ./kind /usr/local/bin/kind

# macOS (brew):
brew install kind

# Windows (winget):
winget install Kubernetes.kind

# kubectl — the Kubernetes CLI
# Linux/macOS:
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x ./kubectl && sudo mv ./kubectl /usr/local/bin/kubectl

# macOS (brew):
brew install kubectl

# Windows (winget):
winget install Kubernetes.kubectl
```

### Create a cluster

```bash
# Create a single-node cluster (perfect for learning)
kind create cluster --name dev

# Verify the cluster is up
kubectl cluster-info

# kind automatically updates your kubeconfig context
kubectl config current-context
# kind-dev
```

You now have a fully functional Kubernetes cluster running inside Docker containers.
Check the nodes:

```bash
kubectl get nodes
# NAME                STATUS   ROLES           AGE   VERSION
# dev-control-plane   Ready    control-plane   30s   v1.31.0
```

### kind cluster config (optional)

For multi-node experiments or custom port mappings, use a config file:

```yaml
# kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
```

```bash
kind create cluster --name dev-multi --config kind-config.yaml
```

A single control-plane node is all you need for this tutorial. Delete with
`kind delete cluster --name dev` when you're done.

## From Compose to manifests

Recall the Compose file from the Docker tutorial. Here's the relevant service for our Go API:

```yaml
# excerpt from docker-compose.yml
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
```

Mapping this to Kubernetes means answering four questions:

| Compose concept | Kubernetes equivalent |
|-----------------|-----------------------|
| `services.api` container | Deployment (Pod template) |
| `ports: "8080:8080"` | Service (ClusterIP or NodePort) |
| `environment:` keys | ConfigMap / Secret + envFrom |
| `depends_on:` | Not needed — Kubernetes restarts Pods until dependencies are reachable; initContainers for ordering |

For the database and cache, we'll keep `postgres` and `redis` as Deployments with their own
Services so the Go API can reach them at `db:5432` and `cache:6379` — same DNS names as Compose.

## Deploy the Go API

We'll build this up incrementally. First, deploy the database.

### A Postgres Deployment

```yaml
# manifests/postgres.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: db
  labels:
    app: db
spec:
  replicas: 1
  selector:
    matchLabels:
      app: db
  template:
    metadata:
      labels:
        app: db
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          env:
            - name: POSTGRES_USER
              value: app
            - name: POSTGRES_PASSWORD
              value: secret
            - name: POSTGRES_DB
              value: app
          ports:
            - containerPort: 5432
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "app"]
            initialDelaySeconds: 5
            periodSeconds: 5
```

```yaml
# manifests/postgres-svc.yaml
apiVersion: v1
kind: Service
metadata:
  name: db
spec:
  selector:
    app: db
  ports:
    - port: 5432
      targetPort: 5432
```

```bash
kubectl apply -f manifests/postgres.yaml
kubectl apply -f manifests/postgres-svc.yaml

kubectl get pods
# NAME                  READY   STATUS    RESTARTS   AGE
# db-7d5f9c8b6-4xqz2   1/1     Running   0          10s

kubectl get svc
# NAME   TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
# db     ClusterIP   10.96.145.23    <none>        5432/TCP   10s
```

The `ClusterIP` Service type (the default) assigns an internal IP that other Pods can reach at
`db:5432` — the Kubernetes DNS resolves `<service-name>.<namespace>.svc.cluster.local`.

### A Redis Deployment (abbreviated)

```yaml
# manifests/redis.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cache
  labels:
    app: cache
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cache
  template:
    metadata:
      labels:
        app: cache
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
---
apiVersion: v1
kind: Service
metadata:
  name: cache
spec:
  selector:
    app: cache
  ports:
    - port: 6379
      targetPort: 6379
```

Note the `---` separator — you can define multiple resources in one file. Kubernetes splits
them into individual documents when you `kubectl apply`.

### The API Deployment

Now the Go API itself. We'll keep it minimal first, then add ConfigMaps and Secrets in the
next section.

```yaml
# manifests/api.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  labels:
    app: api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: myapi:latest
          imagePullPolicy: IfNotPresent
          env:
            - name: DATABASE_URL
              value: "postgres://app:secret@db:5432/app?sslmode=disable"
            - name: REDIS_URL
              value: "redis://cache:6379/0"
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 3
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector:
    app: api
  ports:
    - port: 8080
      targetPort: 8080
```

Key differences from Compose:

- **`imagePullPolicy: IfNotPresent`** tells kind to use the local Docker image instead of
  pulling from a registry. When using kind, build your image with `docker build -t myapi:latest .`
  first, then load it into the cluster with `kind load docker-image myapi:latest --name dev`.

- **Readiness and liveness probes** replace Compose's `healthcheck`. The readiness probe
  controls whether the Pod receives traffic; the liveness probe controls whether Kubernetes
  should restart a stuck container. These are more powerful than a Compose health check
  because the orchestrator acts on them automatically.

- **`replicas: 2`** runs two copies. If one crashes, traffic stops flowing to it (readiness
  fails) and the Deployment controller starts a replacement. Compose can't do this without
  manual intervention.

```bash
# Build and load the image
docker build -t myapi:latest .
kind load docker-image myapi:latest --name dev

# Apply the manifests
kubectl apply -f manifests/api.yaml

# Watch pods come up
kubectl get pods -w
# NAME                  READY   STATUS    RESTARTS   AGE
# api-58f9b7d4c-8km2x   1/1     Running   0          5s
# api-58f9b7d4c-x9prt   1/1     Running   0          5s
# db-7d5f9c8b6-4xqz2    1/1     Running   0          2m
# cache-6c4f8d9b7-wp3k   1/1     Running   0          2m
```

### Test with port-forward

kind doesn't expose NodePorts to the host by default (the nodes are Docker containers).
The simplest way to reach a Service is `kubectl port-forward`:

```bash
# Forward localhost:8080 to the api Service
kubectl port-forward svc/api 8080:8080

# In another terminal
curl http://localhost:8080/health
```

## ConfigMaps and Secrets

Hardcoding `DATABASE_URL` in the Deployment spec is functional but fragile: every environment
needs a different value, and the password is visible in plain text to anyone with `kubectl get`
access. Let's externalise configuration.

### Extract environment variables into a ConfigMap

```yaml
# manifests/api-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
data:
  DATABASE_URL: "postgres://app:secret@db:5432/app?sslmode=disable"
  REDIS_URL: "redis://cache:6379/0"
  LOG_LEVEL: "info"
```

### Store the database password in a Secret

```yaml
# manifests/api-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: api-secret
type: Opaque
stringData:
  DB_PASSWORD: "secret"
```

`stringData` lets you write plain text (handy for dev). In production, use `data` with
base64-encoded values, or better yet, use a tool like **Sealed Secrets** or **External
Secrets Operator** to avoid storing secrets in Git altogether.

```yaml
# manifests/api-secret.yaml — production-style alternative
apiVersion: v1
kind: Secret
metadata:
  name: api-secret
type: Opaque
data:
  DB_PASSWORD: c2VjcmV0      # echo -n "secret" | base64
```

### Reference them from the Deployment

Update `manifests/api.yaml` to pull from ConfigMap and Secret:

```yaml
spec:
  containers:
    - name: api
      image: myapi:latest
      imagePullPolicy: IfNotPresent
      envFrom:
        - configMapRef:
            name: api-config
        - secretRef:
            name: api-secret
      env:
        # String templates aren't natively supported; you can
        # interpolate in your application code:
        - name: DATABASE_URL
          value: "postgres://app:$(DB_PASSWORD)@db:5432/app?sslmode=disable"
      ports:
        - containerPort: 8080
```

Kubernetes resolves `$(DB_PASSWORD)` from the Secret's `DB_PASSWORD` key when the container
starts. If your application reads individual env vars (`DB_HOST`, `DB_USER`, `DB_PASS`,
`DB_NAME`), you can skip the template and use `envFrom` exclusively — even cleaner.

```bash
kubectl apply -f manifests/api-config.yaml
kubectl apply -f manifests/api-secret.yaml
kubectl apply -f manifests/api.yaml  # picks up the new env sources
```

## Expose the service

So far our `api` Service is `ClusterIP` — reachable only inside the cluster. There are
three ways to expose a Service externally:

### ClusterIP (default)

Internal-only. Pods and other Services can reach it. Use this for backend services
(postgres, redis, internal APIs). Port-forward to test locally.

### NodePort

Opens a static port on every node. External traffic hitting `<NodeIP>:<NodePort>` is
forwarded to the Service.

```yaml
# manifests/api-svc-nodeport.yaml
apiVersion: v1
kind: Service
metadata:
  name: api-np
spec:
  type: NodePort
  selector:
    app: api
  ports:
    - port: 8080
      targetPort: 8080
      nodePort: 30080  # 30000-32767 range
```

```bash
kubectl apply -f manifests/api-svc-nodeport.yaml

# With kind, the node is a Docker container. Map the port in kind-config.yaml:
# nodes:
#   - role: control-plane
#     extraPortMappings:
#       - containerPort: 30080
#         hostPort: 8080

curl http://localhost:8080/health
```

NodePort is fine for quick tests but not for production. The port range is limited and
you need a load balancer in front.

### Ingress

An Ingress routes HTTP/S traffic to Services based on hostname and path rules. It requires
an Ingress Controller (like `ingress-nginx`) running in the cluster.

```yaml
# manifests/api-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
spec:
  rules:
    - host: api.localhost
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 8080
```

```bash
# Install the NGINX Ingress Controller on kind
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

# Wait for it to be ready
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=90s

kubectl apply -f manifests/api-ingress.yaml

curl -H "Host: api.localhost" http://localhost/
```

For local development, port-forward is usually the simplest approach. Save Ingress
for staging/production clusters where you need TLS termination, path-based routing,
and hostname-based virtual hosting.

## Scale and update

Kubernetes shines when you need to change your running application without dropping traffic.

### Scaling

The Compose equivalent is `docker compose up --scale api=5`. In Kubernetes:

```bash
# Imperative (quick one-off)
kubectl scale deployment api --replicas=5

# Declarative (edit the manifest and re-apply)
# Change spec.replicas: 5 in api.yaml, then:
kubectl apply -f manifests/api.yaml

kubectl get pods -l app=api
# NAME                  READY   STATUS    RESTARTS   AGE
# api-58f9b7d4c-8km2x   1/1     Running   0          10m
# api-58f9b7d4c-9dk7f   1/1     Running   0          5s
# api-58f9b7d4c-hq6pj   1/1     Running   0          5s
# api-58f9b7d4c-nv3yl   1/1     Running   0          5s
# api-58f9b7d4c-x9prt   1/1     Running   0          10m
```

Scale back down with `kubectl scale deployment api --replicas=2`.

### Rolling update

Build a new image version, load it into kind, and update the Deployment's image:

```bash
# Build v2
docker build -t myapi:v2 .
kind load docker-image myapi:v2 --name dev

# Update the image
kubectl set image deployment/api api=myapi:v2

# Watch the rollout
kubectl rollout status deployment/api
# Waiting for deployment "api" rollout to finish: 1 old replicas pending termination...
# deployment "api" successfully rolled out
```

Kubernetes creates new Pods with `myapi:v2` and terminates old Pods gradually. The Service
only sends traffic to Pods that pass their readiness probe, so there's no downtime.

The default rollout strategy (`RollingUpdate`) lets you control the pace:

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1   # at most 1 Pod can be down during the update
      maxSurge: 1         # at most 1 extra Pod can be created above desired count
```

### Rollback

If the new version is broken, roll back to the previous revision:

```bash
kubectl rollout undo deployment/api

# Or to a specific revision
kubectl rollout history deployment/api
kubectl rollout undo deployment/api --to-revision=1
```

## Debug pods

When something breaks, these three commands cover 90% of debugging:

### `kubectl logs`

Stream logs from a specific container in a Pod:

```bash
# Tail logs from one Pod
kubectl logs -f deployment/api

# If the Pod has crashed and restarted, get logs from the previous instance
kubectl logs deployment/api --previous

# Logs from all Pods matching a label (requires stern or ktail)
# stern is a handy third-party tool:
# stern -l app=api
```

Install stern for multi-pod log tailing:

```bash
# macOS
brew install stern
# Linux
curl -Lo /usr/local/bin/stern \
  https://github.com/stern/stern/releases/latest/download/stern_linux_amd64
chmod +x /usr/local/bin/stern
```

### `kubectl describe`

Get events, conditions, and recent state transitions for a resource:

```bash
kubectl describe deployment api
kubectl describe pod api-58f9b7d4c-8km2x

# Look for Events at the bottom — it shows image pull failures,
# probe failures, scheduling issues, and OOM kills
```

### `kubectl exec`

Run a command inside a running container — the Kubernetes equivalent of `docker exec`:

```bash
# Open a shell
kubectl exec -it deployment/api -- sh

# In an Alpine-based container (bash not available):
kubectl exec -it deployment/api -- /bin/sh

# Check DNS resolution from inside the Pod
kubectl exec -it deployment/api -- nslookup db

# Curl the health endpoint from inside the cluster
kubectl exec -it deployment/api -- wget -qO- http://localhost:8080/health
```

### Quick health check checklist

```bash
# 1. Are the Pods running?
kubectl get pods

# 2. Are the Services resolving?
kubectl get endpoints

# 3. Any events?
kubectl get events --sort-by=.metadata.creationTimestamp | tail -20

# 4. Resource pressure?
kubectl top pods
kubectl top nodes
```

## Cleanup and next steps

```bash
# Delete the cluster
kind delete cluster --name dev

# If you installed the ingress controller, clean up Docker volumes too
docker volume prune
```

You've now covered the bridge from single-host Compose to multi-node Kubernetes. The next
steps in the Cloud & DevOps stream build on this foundation:

- **Helm** — package, version, and share Kubernetes manifests as charts. The Go API manifests
  we wrote by hand become a reusable `values.yaml` with templated resources.

- **GitOps with Argo CD or Flux** — store your manifests in Git and let a controller
  continuously reconcile the cluster toward the desired state in the repo. Merge to main,
  and the cluster updates itself.

- **CI/CD for Kubernetes** — integrate image builds (Docker), vulnerability scans (Trivy),
  and deployment (kubectl/Helm) into GitHub Actions pipelines triggered on push.

- **Observability** — add Prometheus for metrics, Grafana for dashboards, and Loki for
  log aggregation. The `stern` command is a start; a full observability stack turns logs,
  metrics, and traces into actionable information.

Kubernetes is deep, but the core loop — write YAML, `kubectl apply`, verify, iterate —
is the same from your first Deployment to a production cluster with a hundred microservices.
