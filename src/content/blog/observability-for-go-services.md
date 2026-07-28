---
title: "Observability for Go services — logs, metrics, and traces"
date: 2026-07-27
description: "Instrument a Go API with structured logging via slog, request metrics via Prometheus client, and distributed traces via OpenTelemetry — then ship the signals to a Kubernetes observability stack."
tags: ["go", "observability", "prometheus", "opentelemetry", "kubernetes", "devops", "cloud", "logging"]
series:
  id: from-go-api-to-kubernetes
  name: "From Go API to Kubernetes"
  order: 6
  description: "A practical progression from building REST APIs in Go through containerization with Docker to orchestration with Kubernetes."
draft: false
---

## Why observability beats "just monitoring"

In the [Go REST API tutorial](/blog/building-rest-apis-with-go) we built an API
from `net/http` to structured handlers. The [Docker tutorial](/blog/containers-and-docker)
containerised it. The [Kubernetes tutorial](/blog/kubernetes-for-developers) deployed it to a
cluster. The [CI/CD tutorial](/blog/ci-cd-pipelines-with-github-actions) automated the entire
path from `git push` to running Pods.

At this point the series covers the _build_ and _ship_ halves of the DevOps loop. What it
doesn't cover yet is the _run_ half — the day-2 concern of every cloud engineer:

> The service is deployed. How do I know it's healthy?

Monitoring answers "is it up?" (ping, CPU, disk). Observability answers
"why is it slow for this user, right now?" — even if you've never seen the failure mode
before. The difference is the _unknown unknowns_.

Observability is built on three pillars:

| Pillar | Question it answers | Go tooling |
|--------|-------------------|------------|
| **Logging** | What happened at this specific moment? | `log/slog` (stdlib, Go 1.21+) |
| **Metrics** | How many, how fast, how often? | `prometheus/client_golang` |
| **Tracing** | Which services touched this request, and where did time go? | `go.opentelemetry.io/otel` |

Alone, each pillar is a data source. Together, correlated by trace ID and span ID, they
form a system you can interrogate — not just a dashboard you stare at.

This tutorial instruments the Go API from the earlier posts with all three pillars,
then shows how to ship those signals to a Kubernetes-native observability stack.

## Instrumenting a Go service with structured logging

The Go standard library shipped `log/slog` in Go 1.21. It's a structured, leveled logging
package that replaces `log.Printf` and friends. If your `go.mod` declares `go 1.22` (as in
the [REST API tutorial](/blog/building-rest-apis-with-go)), you already have it.

### From `log.Printf` to `slog`

Before — the typical ad-hoc logging you'd find in a prototype:

```go
log.Printf("request %s %s took %v", r.Method, r.URL.Path, elapsed)
```

After — structured logging with `slog`:

```go
slog.Info("request completed",
    "method", r.Method,
    "path", r.URL.Path,
    "duration", elapsed,
    "status", statusCode,
)
```

The first difference: `slog` separates the message from the structured key-value pairs.
The second: leveled loggers (`Debug`, `Info`, `Warn`, `Error`) let you control verbosity
at runtime without touching code.

### Setting up the logger: JSON for production, text for dev

Create a package-level logger that reads its format from an environment variable:

```go
// internal/observability/logging.go
package observability

import (
    "log/slog"
    "os"
)

var Logger *slog.Logger

func InitLogger() {
    var handler slog.Handler

    format := os.Getenv("LOG_FORMAT")
    level := os.Getenv("LOG_LEVEL")

    var logLevel slog.Level
    switch level {
    case "debug":
        logLevel = slog.LevelDebug
    case "warn":
        logLevel = slog.LevelWarn
    case "error":
        logLevel = slog.LevelError
    default:
        logLevel = slog.LevelInfo
    }

    opts := &slog.HandlerOptions{
        Level: logLevel,
    }

    if format == "json" {
        handler = slog.NewJSONHandler(os.Stdout, opts)
    } else {
        handler = slog.NewTextHandler(os.Stdout, opts)
    }

    Logger = slog.New(handler)
    slog.SetDefault(Logger)
}
```

In development, leave `LOG_FORMAT` unset and you get human-readable output:

```
time=2026-07-27T10:15:00.000Z level=INFO msg="server starting" addr=:8080
```

In production, set `LOG_FORMAT=json` and every line is a JSON object — parseable by
Loki, Elasticsearch, Datadog, or any log aggregator:

```json
{"time":"2026-07-27T10:15:00.000Z","level":"INFO","msg":"server starting","addr":":8080"}
```

### Middleware that adds context to every request

A logging middleware should attach a request ID, capture the duration, and log a single
line per request — not a scattered trail of printf calls:

```go
// internal/middleware/logging.go
package middleware

import (
    "log/slog"
    "net/http"
    "time"

    "github.com/google/uuid"
)

type responseWriter struct {
    http.ResponseWriter
    statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
    rw.statusCode = code
    rw.ResponseWriter.WriteHeader(code)
}

func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        requestID := uuid.New().String()

        ctx := r.Context()
        logger := slog.Default().With(
            "request_id", requestID,
            "method", r.Method,
            "path", r.URL.Path,
        )
        ctx = contextWithLogger(ctx, logger)

        w.Header().Set("X-Request-Id", requestID)

        rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
        next.ServeHTTP(rw, r.WithContext(ctx))

        duration := time.Since(start)
        logger.Info("request completed",
            "status", rw.statusCode,
            "duration_ms", duration.Milliseconds(),
            "remote_addr", r.RemoteAddr,
        )
    })
}
```

The `contextWithLogger` helper stores the logger in the request context so downstream
handlers can pull it out and add their own fields — for example, a user ID after
authentication:

```go
func contextWithLogger(ctx context.Context, logger *slog.Logger) context.Context {
    return context.WithValue(ctx, loggerKey{}, logger)
}

type loggerKey struct{}

func FromContext(ctx context.Context) *slog.Logger {
    if logger, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok {
        return logger
    }
    return slog.Default()
}
```

Register the middleware in `main.go`:

```go
r := chi.NewRouter()
r.Use(middleware.Logging)
```

Now every request produces one structured log line with a `request_id` you can search
across all your logs.

## Collecting metrics with Prometheus

Metrics answer the aggregate questions: _how many requests per second?_, _what's the
p99 latency?_, _what's the error rate?_ The Prometheus client library for Go exposes
these as counters, histograms, and gauges on a `/metrics` endpoint that Prometheus
scrapes every 15–60 seconds.

### Install the Prometheus client

```bash
go get github.com/prometheus/client_golang@latest
```

### Define the metrics

Create a file that registers all the metrics your API will export:

```go
// internal/observability/metrics.go
package observability

import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var (
    HTTPRequestsTotal = promauto.NewCounterVec(
        prometheus.CounterOpts{
            Name: "http_requests_total",
            Help: "Total number of HTTP requests.",
        },
        []string{"method", "path", "status"},
    )

    HTTPRequestDuration = promauto.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "http_request_duration_seconds",
            Help:    "HTTP request duration in seconds.",
            Buckets: prometheus.DefBuckets,
        },
        []string{"method", "path"},
    )

    HTTPRequestsInFlight = promauto.NewGauge(
        prometheus.GaugeOpts{
            Name: "http_requests_in_flight",
            Help: "Number of HTTP requests currently being handled.",
        },
    )
)
```

A few design decisions baked into these definitions:

- **Counter** for `http_requests_total` — it only ever goes up. Prometheus's rate()
  function derives per-second rates from the cumulative count. No need to reset it.
- **Histogram** for `http_request_duration_seconds` — it tracks the distribution across
  configurable buckets. `prometheus.DefBuckets` gives you `.005, .01, .025, .05, .1, .25,
  .5, 1, 2.5, 5, 10` seconds — enough resolution for most HTTP services.
- **Gauge** for in-flight requests — it goes up and down. Useful for detecting request
  pile-ups (a steady climb without a drop means something is slow downstream).
- **Labels** are kept minimal (`method`, `path`, `status`). Every unique combination of
  label values creates a new time series. A label on `user_id` or `request_id` would
  explode cardinality. The cardinality rule: if the set of possible values is unbounded,
  it's a log field, not a metric label.

### Middleware that records metrics

A companion middleware to our logging one, this time recording counters and histograms:

```go
// internal/middleware/metrics.go
package middleware

import (
    "net/http"
    "strconv"
    "time"

    "github.com/dhanifudin/go-api-demo/internal/observability"
)

func Metrics(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        observability.HTTPRequestsInFlight.Inc()
        defer observability.HTTPRequestsInFlight.Dec()

        start := time.Now()
        rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
        next.ServeHTTP(rw, r)
        duration := time.Since(start).Seconds()

        status := strconv.Itoa(rw.statusCode)
        observability.HTTPRequestsTotal.WithLabelValues(r.Method, r.URL.Path, status).Inc()
        observability.HTTPRequestDuration.WithLabelValues(r.Method, r.URL.Path).Observe(duration)
    })
}
```

### Expose the `/metrics` endpoint

Add the Prometheus HTTP handler to your router:

```go
import (
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
    // ... logger init, router setup ...

    r.Use(middleware.Logging)
    r.Use(middleware.Metrics)

    r.Handle("GET /metrics", promhttp.Handler())

    // ... your application routes ...

    slog.Info("server starting", "addr", ":8080")
    if err := http.ListenAndServe(":8080", r); err != nil {
        slog.Error("server stopped", "error", err)
        os.Exit(1)
    }
}
```

Fire up the API and curl the endpoint:

```bash
go run ./cmd/api &

# Send a few requests to generate metrics
curl http://localhost:8080/health
curl http://localhost:8080/health
curl http://localhost:8080/api/items

# Scrape the metrics endpoint
curl -s http://localhost:8080/metrics | grep -E "^http_"
```

You'll see output like:

```
# HELP http_requests_in_flight Number of HTTP requests currently being handled.
# TYPE http_requests_in_flight gauge
http_requests_in_flight 0

# HELP http_requests_total Total number of HTTP requests.
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/items",status="200"} 1
http_requests_total{method="GET",path="/health",status="200"} 2

# HELP http_request_duration_seconds HTTP request duration in seconds.
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",path="/health",le="0.005"} 2
http_request_duration_seconds_bucket{method="GET",path="/health",le="0.01"} 2
...
http_request_duration_seconds_sum{method="GET",path="/health"} 0.000184
http_request_duration_seconds_count{method="GET",path="/health"} 2
```

That's it — your Go API now exports Prometheus metrics with zero external process
dependencies.

### Path cardinality: use a route pattern, not the raw URL

The `r.URL.Path` in the metric label above will explode cardinality if your API has
parameterised routes like `/api/items/42`. Every item ID creates a new time series.

Fix this by extracting the route pattern from chi's context:

```go
import (
    "github.com/go-chi/chi/v5"
)

func Metrics(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        observability.HTTPRequestsInFlight.Inc()
        defer observability.HTTPRequestsInFlight.Dec()

        start := time.Now()
        rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
        next.ServeHTTP(rw, r)
        duration := time.Since(start).Seconds()

        // Use chi's route pattern instead of the raw path to keep cardinality bounded
        pattern := chi.RouteContext(r.Context()).RoutePattern()
        if pattern == "" {
            pattern = r.URL.Path
        }

        status := strconv.Itoa(rw.statusCode)
        observability.HTTPRequestsTotal.WithLabelValues(r.Method, pattern, status).Inc()
        observability.HTTPRequestDuration.WithLabelValues(r.Method, pattern).Observe(duration)
    })
}
```

Now `/api/items/42` and `/api/items/99` both label as `/api/items/{itemID}` — one
time series instead of N.

## Distributed tracing with OpenTelemetry

Logs tell you what happened on one machine. Metrics tell you the aggregate picture.
Traces tell you the journey of a single request across process boundaries — which
services it touched, how long each hop took, and where the bottleneck sits.

OpenTelemetry (OTel) is the CNCF standard for generating, collecting, and exporting
telemetry data. The Go SDK provides auto-instrumentation for `net/http` handlers and
clients, so you can trace your API with minimal code changes.

### Install the OTel packages

```bash
go get go.opentelemetry.io/otel@latest
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp@latest
go get go.opentelemetry.io/otel/sdk/trace@latest
go get go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp@latest
```

### Initialise the tracer provider

Set up a tracer that exports spans to an OTLP collector (e.g. an OpenTelemetry Collector
sidecar or a SaaS backend):

```go
// internal/observability/tracing.go
package observability

import (
    "context"
    "fmt"
    "os"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/propagation"
    "go.opentelemetry.io/otel/sdk/resource"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func InitTracer(ctx context.Context) (func(context.Context) error, error) {
    endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if endpoint == "" {
        endpoint = "localhost:4318"
    }

    exporter, err := otlptracehttp.New(ctx,
        otlptracehttp.WithEndpoint(endpoint),
        otlptracehttp.WithInsecure(), // TLS off for local dev; enable in production
    )
    if err != nil {
        return nil, fmt.Errorf("create OTLP exporter: %w", err)
    }

    res, err := resource.New(ctx,
        resource.WithAttributes(
            semconv.ServiceName("go-api"),
            semconv.ServiceVersion("1.0.0"),
        ),
    )
    if err != nil {
        return nil, fmt.Errorf("create resource: %w", err)
    }

    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(exporter),
        sdktrace.WithResource(res),
        sdktrace.WithSampler(sdktrace.AlwaysSample()),
    )

    otel.SetTracerProvider(tp)
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{},
        propagation.Baggage{},
    ))

    return tp.Shutdown, nil
}
```

A few things happening here:

- `resource.Resource` identifies your service to the collector — the
  `service.name` and `service.version` attributes follow the OpenTelemetry
  semantic conventions so your traces are searchable by service.
- `BatchSpanProcessor` (via `WithBatcher`) queues spans in memory and flushes
  them to the collector in batches — this is critical for performance in
  production. The processor is the default; no extra config needed.
- `AlwaysSample()` is fine for local development. In production, switch to
  `TraceIDRatioBased(0.1)` or `ParentBased(TraceIDRatioBased(...))` to
  sample only a fraction of traces.
- `TextMapPropagator` injects the trace context (trace ID + span ID) into
  HTTP headers so downstream services can continue the same trace.

### Shutdown on exit

In `main.go`, call `InitTracer` at startup and defer the shutdown function:

```go
func main() {
    observability.InitLogger()

    ctx := context.Background()
    tracerShutdown, err := observability.InitTracer(ctx)
    if err != nil {
        slog.Error("failed to initialise tracer", "error", err)
        os.Exit(1)
    }
    defer func() {
        if err := tracerShutdown(ctx); err != nil {
            slog.Error("failed to shut down tracer", "error", err)
        }
    }()

    // ... router setup ...

    http.ListenAndServe(":8080", r)
}
```

The deferred shutdown flushes any remaining spans before the process exits — without
it, the last few spans are lost.

### Auto-instrument HTTP handlers and clients

The `otelhttp` package wraps `http.Handler` and `http.RoundTripper` to create spans
automatically:

```go
import (
    "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func main() {
    // ... tracer init ...

    r := chi.NewRouter()
    r.Use(middleware.Logging)
    r.Use(middleware.Metrics)

    // Wrap the entire router with OTel instrumentation
    instrumented := otelhttp.NewHandler(r, "go-api")

    // Also instrument outgoing HTTP calls
    httpClient := &http.Client{
        Transport: otelhttp.NewTransport(http.DefaultTransport),
    }

    // ... use httpClient for downstream calls ...

    http.ListenAndServe(":8080", instrumented)
}
```

That's it. Every incoming request now creates a span named `go-api` (or more
specifically `GET /api/items` when combined with chi's routing). If the handler
makes an outbound HTTP call using the instrumented `httpClient`, OpenTelemetry
creates a child span and propagates the trace context through the `traceparent`
header — the downstream service picks it up and continues the same trace.

### Running a local collector and viewing traces

For local development, run Jaeger's all-in-one image (it accepts OTLP):

```bash
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Start your Go API (it sends traces to `localhost:4318` by default), then send a
few requests:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/items
```

Open Jaeger at `http://localhost:16686`, select the `go-api` service, and you'll
see a trace for each request. Click into a trace and you'll see:

```
Trace: abc123def456
├── go-api (server span) ................ 2.3ms
│   ├── GET /api/items .................. 1.8ms
│   └── HTTP GET http://user-svc:8081 ... 0.4ms  (client span)
```

Each span shows start time, duration, and attributes (HTTP method, URL, status code,
and user-agent). If there's a slow spot, the waterfall view makes it obvious.

## Connecting the three pillars

Data becomes observability when you can correlate across pillars. The key: inject
trace and span IDs into every log line so you can jump from an error log to the
full trace, or from a slow trace to the metric that captured it.

### Inject trace context into structured logs

Update the logging middleware to extract the trace ID and span ID from the OpenTelemetry
context and attach them to the logger:

```go
import (
    "go.opentelemetry.io/otel/trace"
)

func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        requestID := uuid.New().String()

        span := trace.SpanFromContext(r.Context())
        traceID := span.SpanContext().TraceID().String()
        spanID := span.SpanContext().SpanID().String()

        logger := slog.Default().With(
            "request_id", requestID,
            "trace_id", traceID,
            "span_id", spanID,
            "method", r.Method,
            "path", r.URL.Path,
        )

        ctx := contextWithLogger(r.Context(), logger)
        rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
        next.ServeHTTP(rw, r.WithContext(ctx))

        duration := time.Since(start)
        logger.Info("request completed",
            "status", rw.statusCode,
            "duration_ms", duration.Milliseconds(),
        )
    })
}
```

Now every log line carries `trace_id` and `span_id`. In Loki, you can search
`{trace_id="abc123def456"}` and see every log line from every service that
participated in that trace.

### Correlated query example

When a user reports a slow request:
1. Find the trace ID from the error log or a high-latency alert.
2. Paste it into Jaeger to see the full waterfall — which service hop was slow?
3. Search Loki for the same trace ID to see the structured logs from each
   service, including the database query parameters and cache hits.

Without correlation, you'd be grepping raw log files by timestamp, guessing
which `INFO` line belongs to which request.

### Cardinality discipline: what to label, what to log

A common mistake when instrumenting the first service is labelling metrics with
high-cardinality values. Here's a decision table:

| Value | Metric label? | Log field? | Why |
|-------|--------------|-----------|-----|
| HTTP method | Yes | Optional | Bounded set (GET, POST, etc.) |
| Route pattern | Yes | Optional | Bounded by number of routes |
| Status code | Yes | Optional | Bounded (2xx, 4xx, 5xx) |
| Request ID | No | Yes | Unbounded — one per request |
| Trace ID | No | Yes | Unbounded |
| User ID | No | Yes | Unbounded in production |
| IP address | No | Yes | Unbounded |
| Query parameters | No | Yes | Unbounded |

A good rule of thumb: if the set of possible values is smaller than your number of
routes, it's a label. If not, it's a log field.

In containerised environments this matters doubly — every Pod restart creates a new
set of label combinations for `pod` and `instance`. Prometheus's relabelling rules
can drop these, but it's safer to avoid labelling by ephemeral attributes at the
source.

## Kubernetes-ready deployment considerations

The [Kubernetes tutorial](/blog/kubernetes-for-developers) deployed the Go API as a
Deployment behind a Service. The [CI/CD tutorial](/blog/ci-cd-pipelines-with-github-actions)
automated the image build and deployment. Now we need to add the observability
infrastructure so those signals reach a dashboard.

### Annotate the Service for Prometheus scraping

The simplest way to tell Prometheus to scrape your API's `/metrics` endpoint is a pair
of annotations on the Service:

```yaml
# manifests/api-svc.yaml (additions shown)
apiVersion: v1
kind: Service
metadata:
  name: api
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "8080"
    prometheus.io/path: "/metrics"
spec:
  selector:
    app: api
  ports:
    - port: 8080
      targetPort: 8080
```

These annotations are read by the Prometheus community Helm chart and by the
Prometheus Operator. If you're using the Operator, the same config looks like this:

```yaml
# manifests/api-servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api
  labels:
    release: prometheus          # must match the Operator's serviceMonitorSelector
spec:
  selector:
    matchLabels:
      app: api
  endpoints:
    - port: http                 # matches the port name in your Service
      path: /metrics
      interval: 30s
```

The ServiceMonitor is the Kubernetes-native way — no annotations, no relabelling
hacks, and it works with the Operator's RBAC-scoped discovery.

### OTLP Collector as a sidecar

The OpenTelemetry Collector receives spans (and logs, and metrics) from your
application and forwards them to backends — Jaeger, Grafana Tempo, Datadog, or any
OTLP-compatible service.

In Kubernetes, the cleanest pattern for a single service is the **sidecar**:

```yaml
# manifests/api.yaml (partial — showing the sidecar addition)
spec:
  template:
    spec:
      containers:
        - name: api
          image: ghcr.io/dhanifudin/go-api-demo:latest
          env:
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "localhost:4318"  # sidecar shares the Pod's network namespace
          # ... existing env, probes, ports ...

        - name: otel-collector
          image: otel/opentelemetry-collector-contrib:0.108.0
          args:
            - --config=/etc/otel/config.yaml
          volumeMounts:
            - name: otel-config
              mountPath: /etc/otel
              readOnly: true
          ports:
            - containerPort: 4318   # OTLP HTTP
              name: otlp-http
            - containerPort: 4317   # OTLP gRPC
              name: otlp-grpc

      volumes:
        - name: otel-config
          configMap:
            name: otel-collector-config
```

The Collector config (mounted from a ConfigMap) defines the pipeline:

```yaml
# manifests/otel-collector-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-config
data:
  config.yaml: |
    receivers:
      otlp:
        protocols:
          http:
            endpoint: 0.0.0.0:4318
          grpc:
            endpoint: 0.0.0.0:4317

    processors:
      batch:
        timeout: 5s
        send_batch_size: 512

    exporters:
      otlphttp/tempo:
        endpoint: http://tempo.monitoring.svc:4318
        tls:
          insecure: true
      logging:
        loglevel: debug

    service:
      pipelines:
        traces:
          receivers: [otlp]
          processors: [batch]
          exporters: [otlphttp/tempo, logging]
```

The sidecar pattern means each Pod ships its own collector. This is simple and
isolated — no shared Collector DaemonSet that becomes a single point of
failure — but it costs an extra ~50 MiB of memory per Pod. For production at
scale, use a DaemonSet or a centralised gateway Collector.

### Set the log format for production

Update the ConfigMap from the Kubernetes tutorial to set the log format:

```yaml
# manifests/api-config.yaml (additions shown)
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
data:
  DATABASE_URL: "postgres://app:$(DB_PASSWORD)@db:5432/app?sslmode=disable"
  REDIS_URL: "redis://cache:6379/0"
  LOG_FORMAT: "json"
  LOG_LEVEL: "info"
```

With JSON logging and the trace/span IDs injected, every log line is a
self-describing object that your log aggregator can index.

### Avoiding cardinality explosion in containers

Kubernetes adds metadata that can blow up your Prometheus time series count
if you're not careful:

- **Pod name** changes on every restart. Don't label metrics by pod name.
- **Node name** changes when a Pod is rescheduled. Avoid unless you're debugging
  node-specific issues.
- **Container ID** is unique per run. Never a metric label.

Prometheus discovers your Pods via the Service's endpoints. By default it attaches
`pod`, `namespace`, `node`, and `container` labels. Use `metricRelabelings` in your
ServiceMonitor (or scrape config) to drop the high-cardinality labels:

```yaml
spec:
  endpoints:
    - port: http
      metricRelabelings:
        - action: labeldrop
          regex: "pod|container_id|instance"
```

Drop the ones you don't query and keep `namespace` and `service` — those are
bounded and useful for multi-service dashboards.

## Conclusion and next steps

You've now instrumented a Go service with all three pillars of observability:

- **Logs** — `log/slog` with structured JSON output, request IDs, and contextual
  fields injected via middleware.
- **Metrics** — Prometheus counters, histograms, and gauges exposed on `/metrics`,
  with route-pattern labels to keep cardinality low.
- **Traces** — OpenTelemetry auto-instrumentation of HTTP handlers and clients,
  exporting to an OTLP collector with trace context propagation.

The three pillars are connected: every log line carries a trace ID, every request
is counted in a Prometheus metric, and every span links to its parent. When a user
reports slowness, you don't guess — you query.

The next steps build on this foundation:

- **Grafana dashboards** — plug Prometheus and Loki into Grafana (the `grafana/grafana`
  Helm chart deploys in minutes). Build a RED (Rate, Errors, Duration) dashboard for
  each service and link log panels to trace views via the trace ID.
- **Alerting** — define Prometheus alerting rules for error rate spikes, p99 latency
  breaches, and 5xx percentage thresholds. Route alerts through Alertmanager to Slack,
  PagerDuty, or email.
- **Service Level Objectives (SLOs)** — turn "the service is healthy" from a feeling
  into a number. Measure the error budget consumed over a rolling 30-day window and
  use it to gate releases: if the error budget is exhausted, no deploys until it
  recovers.
- **Profiling** — add `runtime/pprof` endpoints to the Go API and scrape them with
  Pyroscope or Grafana Phlare. CPU and memory profiles answer the "why is it slow?"
  question from a different angle — inside the process, not across services.
- **Log aggregation with Loki** — deploy Loki via its Helm chart, configure
  Promtail (or the Grafana Agent) to tail your Pod logs, and index the JSON fields
  so `{service="go-api", trace_id="..."}` is a one-click query.

Observability isn't a checklist you complete on launch day. It's a loop: ship code,
watch the signals, find the bottleneck, fix it, ship again. The instrumentation you
added today makes that loop measurable — and that's the difference between hoping
your service is healthy and knowing it is.
