---
title: "Building REST APIs with Go — from net/http to structured handlers"
date: 2026-06-29
description: "Build a complete REST API in Go: start with the standard library, add routing with chi, structure your JSON handlers, wire up CRUD with an in-memory store, layer on middleware, and test everything with table-driven tests."
tags: ["go", "backend", "rest", "api"]
draft: false
---

## Why Go for backend services

Go was designed at Google for the kind of networked services that power the internet.
Its standard library ships with a production-grade HTTP server (`net/http`), a JSON
encoder/decoder (`encoding/json`), and a testing framework (`testing`) — no framework
required. You can build and deploy an API with zero third-party dependencies.

Beyond the stdlib, Go brings practical advantages for backend work:

- **Static binaries.** `go build` produces a single executable with no runtime dependency.
  Copy it to a server or scratch container and you're done. No virtualenv, no node_modules,
  no JVM.
- **Fast compile times.** Even at tens of thousands of lines, compilation is measured in
  seconds, not minutes. The edit-compile-run loop stays tight.
- **Concurrency built in.** Goroutines and channels make it straightforward to handle
  thousands of concurrent connections without callback hell or thread-pool tuning.
- **Deployment ergonomics.** A 10 MB binary that starts in milliseconds is a perfect
  fit for containers and serverless. The Docker post on this site shows how to package
  a Go API into an 8 MB scratch image.

This tutorial walks you through building a complete REST API from scratch — starting with
the standard library, then layering on routing, structured handlers, middleware, shutdown
handling, and tests. By the end you'll have a reusable project template that you can
containerise and deploy.

## Project layout and dependencies

Create a new module and set up the directory structure:

```bash
mkdir go-api-demo && cd go-api-demo
go mod init github.com/dhanifudin/go-api-demo
```

```
go-api-demo/
├── cmd/
│   └── api/
│       └── main.go
├── internal/
│   ├── handlers/
│   │   ├── items.go
│   │   └── items_test.go
│   ├── middleware/
│   │   ├── logging.go
│   │   ├── recovery.go
│   │   └── middleware_test.go
│   └── store/
│       ├── memory.go
│       └── memory_test.go
└── go.mod
```

`cmd/api/` holds the entrypoint. `internal/handlers/` contains HTTP handler functions.
`internal/store/` is the data layer (in-memory for now). `internal/middleware/` holds
cross-cutting concerns. The `internal` directory convention prevents other modules from
importing these packages — they're private to your application.

For routing, we'll use [chi](https://github.com/go-chi/chi) — a lightweight, idiomatic
router that composes well with `net/http`:

```bash
go get github.com/go-chi/chi/v5
```

Your `go.mod` should look like:

```
module github.com/dhanifudin/go-api-demo

go 1.22

require github.com/go-chi/chi/v5 v5.2.1
```

## A minimal `net/http` server

Before reaching for a framework, understand what the standard library gives you. Here's
the smallest possible HTTP API:

```go
// cmd/api/main.go
package main

import (
    "encoding/json"
    "log"
    "net/http"
)

func main() {
    http.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
    })

    log.Println("listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

```bash
go run ./cmd/api
# In another terminal:
curl http://localhost:8080/health
# {"status":"ok"}
```

The Go 1.22 routing enhancements (`"GET /health"` syntax) let you specify the HTTP method
directly in the pattern. This is a big improvement over the old `"/health"` pattern, which
matched any method and required manual checks.

But `http.HandleFunc` hits walls quickly:

- **No path parameters.** `/items/{id}` requires parsing the URL yourself.
- **No middleware chaining.** Logging, auth, CORS — you'd wrap each handler manually.
- **No route grouping.** Prefixes like `/api/v1/` mean repeated pattern strings.

For a real API, these limitations add up. That's where `chi` comes in.

## Routing with `chi`

`chi` builds on `net/http` instead of replacing it. A `chi.Mux` is an `http.Handler`, so
it works with any middleware that expects a standard `http.Handler`. No lock-in.

```go
// cmd/api/main.go
package main

import (
    "encoding/json"
    "log"
    "net/http"

    "github.com/dhanifudin/go-api-demo/internal/handlers"
    "github.com/dhanifudin/go-api-demo/internal/store"

    "github.com/go-chi/chi/v5"
)

func main() {
    r := chi.NewRouter()

    r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
    })

    // Item routes — we'll implement these next
    s := store.NewMemory()
    h := handlers.NewItemHandler(s)

    r.Route("/items", func(r chi.Router) {
        r.Get("/", h.List)
        r.Get("/{id}", h.Get)
        r.Post("/", h.Create)
        r.Put("/{id}", h.Update)
        r.Delete("/{id}", h.Delete)
    })

    log.Println("listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", r))
}
```

`r.Route("/items", ...)` scopes all child routes under that prefix. `{id}` captures a
path segment into `chi.URLParam(r, "id")`. `r.Get`, `r.Post`, `r.Put`, `r.Delete` map
directly to HTTP methods — no manual `r.Method` checks.

## Structured JSON handlers

Raw `http.HandlerFunc` works, but in a growing codebase a consistent handler pattern
prevents duplication. Every handler needs to encode JSON on success, encode JSON on
error, and set the same headers. Extract that into helpers:

```go
// internal/handlers/response.go
package handlers

import (
    "encoding/json"
    "net/http"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
    writeJSON(w, status, map[string]string{"error": message})
}
```

Now every handler follows the same contract: accept `w` and `r`, call the store, return
through `writeJSON` or `writeError`.

## In-memory store and CRUD endpoints

Start with a simple in-memory store backed by a `sync.RWMutex`-protected map. This lets
you focus on HTTP semantics without a database setup.

```go
// internal/store/memory.go
package store

import (
    "fmt"
    "sync"
    "time"
)

type Item struct {
    ID        string    `json:"id"`
    Name      string    `json:"name"`
    Price     float64   `json:"price"`
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
}

type Memory struct {
    mu    sync.RWMutex
    items map[string]Item
    seq   int
}

func NewMemory() *Memory {
    return &Memory{items: make(map[string]Item)}
}

func (m *Memory) List() []Item {
    m.mu.RLock()
    defer m.mu.RUnlock()

    items := make([]Item, 0, len(m.items))
    for _, item := range m.items {
        items = append(items, item)
    }
    return items
}

func (m *Memory) Get(id string) (Item, bool) {
    m.mu.RLock()
    defer m.mu.RUnlock()

    item, ok := m.items[id]
    return item, ok
}

func (m *Memory) Create(name string, price float64) Item {
    m.mu.Lock()
    defer m.mu.Unlock()

    m.seq++
    id := fmt.Sprintf("%d", m.seq)

    now := time.Now()
    item := Item{
        ID:        id,
        Name:      name,
        Price:     price,
        CreatedAt: now,
        UpdatedAt: now,
    }
    m.items[id] = item
    return item
}

func (m *Memory) Update(id, name string, price float64) (Item, bool) {
    m.mu.Lock()
    defer m.mu.Unlock()

    item, ok := m.items[id]
    if !ok {
        return Item{}, false
    }
    if name != "" {
        item.Name = name
    }
    if price > 0 {
        item.Price = price
    }
    item.UpdatedAt = time.Now()
    m.items[id] = item
    return item, true
}

func (m *Memory) Delete(id string) bool {
    m.mu.Lock()
    defer m.mu.Unlock()

    _, ok := m.items[id]
    if !ok {
        return false
    }
    delete(m.items, id)
    return true
}
```

Next, the handler that bridges HTTP and the store:

```go
// internal/handlers/items.go
package handlers

import (
    "encoding/json"
    "net/http"

    "github.com/dhanifudin/go-api-demo/internal/store"

    "github.com/go-chi/chi/v5"
)

type ItemHandler struct {
    store *store.Memory
}

func NewItemHandler(s *store.Memory) *ItemHandler {
    return &ItemHandler{store: s}
}

func (h *ItemHandler) List(w http.ResponseWriter, r *http.Request) {
    items := h.store.List()
    writeJSON(w, http.StatusOK, items)
}

func (h *ItemHandler) Get(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    item, ok := h.store.Get(id)
    if !ok {
        writeError(w, http.StatusNotFound, "item not found")
        return
    }
    writeJSON(w, http.StatusOK, item)
}

type createRequest struct {
    Name  string  `json:"name"`
    Price float64 `json:"price"`
}

func (h *ItemHandler) Create(w http.ResponseWriter, r *http.Request) {
    var req createRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, http.StatusBadRequest, "invalid JSON")
        return
    }
    if req.Name == "" || req.Price <= 0 {
        writeError(w, http.StatusBadRequest, "name and positive price are required")
        return
    }
    item := h.store.Create(req.Name, req.Price)
    writeJSON(w, http.StatusCreated, item)
}

func (h *ItemHandler) Update(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")

    var req createRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, http.StatusBadRequest, "invalid JSON")
        return
    }

    item, ok := h.store.Update(id, req.Name, req.Price)
    if !ok {
        writeError(w, http.StatusNotFound, "item not found")
        return
    }
    writeJSON(w, http.StatusOK, item)
}

func (h *ItemHandler) Delete(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    if !h.store.Delete(id) {
        writeError(w, http.StatusNotFound, "item not found")
        return
    }
    w.WriteHeader(http.StatusNoContent)
}
```

Run the server and exercise the endpoints:

```bash
go run ./cmd/api

# Create an item
curl -s -X POST http://localhost:8080/items \
  -H "Content-Type: application/json" \
  -d '{"name":"Mechanical Keyboard","price":149.99}' | jq
# {
#   "id": "1",
#   "name": "Mechanical Keyboard",
#   "price": 149.99,
#   "created_at": "2026-06-29T...",
#   "updated_at": "2026-06-29T..."
# }

# List all items
curl -s http://localhost:8080/items | jq

# Get by ID
curl -s http://localhost:8080/items/1 | jq

# Update
curl -s -X PUT http://localhost:8080/items/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Wireless Mechanical Keyboard","price":179.99}' | jq

# Delete
curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:8080/items/1
# 204
```

## Middleware essentials

Middleware in `chi` (and `net/http` in general) is a function that takes an `http.Handler`
and returns an `http.Handler`. You can apply middleware globally, to route groups, or to
individual routes.

### Logging middleware

```go
// internal/middleware/logging.go
package middleware

import (
    "log"
    "net/http"
    "time"
)

type responseWriter struct {
    http.ResponseWriter
    status int
    size   int
}

func (rw *responseWriter) WriteHeader(code int) {
    rw.status = code
    rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
    size, err := rw.ResponseWriter.Write(b)
    rw.size += size
    return size, err
}

func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        wrapped := &responseWriter{ResponseWriter: w, status: http.StatusOK}

        next.ServeHTTP(wrapped, r)

        log.Printf("%s %s %d %s %d",
            r.Method,
            r.URL.Path,
            wrapped.status,
            time.Since(start),
            wrapped.size,
        )
    })
}
```

Wrap the response writer to capture the status code (the standard `ResponseWriter` doesn't
expose it after `WriteHeader`). The log line includes method, path, status, duration, and
response size — everything you need to spot slow endpoints and error rates.

### Recovery middleware

A panic in a handler should never crash the server. Recovery middleware catches panics,
logs the stack trace, and returns a 500:

```go
// internal/middleware/recovery.go
package middleware

import (
    "log"
    "net/http"
    "runtime/debug"
)

func Recovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if err := recover(); err != nil {
                log.Printf("panic: %v\n%s", err, debug.Stack())
                http.Error(w, "Internal Server Error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

### Content-Type enforcement

```go
// internal/middleware/content_type.go
package middleware

import "net/http"

func JSONContentType(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        next.ServeHTTP(w, r)
    })
}
```

### Wiring them together

```go
// cmd/api/main.go
func main() {
    r := chi.NewRouter()

    r.Use(middleware.Recovery)
    r.Use(middleware.Logging)
    r.Use(middleware.JSONContentType)

    // ... routes
}
```

`r.Use` applies middleware to all routes. For a subset, use `r.Group(fn)` or `r.With(...)`:

```go
r.Route("/api/v1", func(r chi.Router) {
    r.Use(rateLimiter)            // only on /api/v1/*
    r.Get("/items", h.List)
})
```

## Configuration and graceful shutdown

Hardcoding `:8080` is fine for development, but production services should read the port
from the environment. Graceful shutdown ensures in-flight requests complete before the
process exits:

```go
// cmd/api/main.go
package main

import (
    "context"
    "log"
    "net/http"
    "os"
    "os/signal"
    "time"

    "github.com/dhanifudin/go-api-demo/internal/handlers"
    "github.com/dhanifudin/go-api-demo/internal/middleware"
    "github.com/dhanifudin/go-api-demo/internal/store"

    "github.com/go-chi/chi/v5"
)

func main() {
    port := os.Getenv("PORT")
    if port == "" {
        port = "8080"
    }

    s := store.NewMemory()
    h := handlers.NewItemHandler(s)

    r := chi.NewRouter()
    r.Use(middleware.Recovery)
    r.Use(middleware.Logging)

    r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
        writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
    })

    r.Route("/items", func(r chi.Router) {
        r.Get("/", h.List)
        r.Get("/{id}", h.Get)
        r.Post("/", h.Create)
        r.Put("/{id}", h.Update)
        r.Delete("/{id}", h.Delete)
    })

    srv := &http.Server{
        Addr:         ":" + port,
        Handler:      r,
        ReadTimeout:  5 * time.Second,
        WriteTimeout: 10 * time.Second,
        IdleTimeout:  15 * time.Second,
    }

    // Start the server in a goroutine so we can listen for shutdown signals
    go func() {
        log.Printf("listening on :%s", port)
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatalf("server error: %v", err)
        }
    }()

    // Wait for interrupt signal
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
    defer stop()

    <-ctx.Done()
    log.Println("shutting down gracefully...")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Fatalf("shutdown error: %v", err)
    }
    log.Println("server stopped")
}
```

`signal.NotifyContext` creates a context that cancels on `SIGINT` (Ctrl+C) or `SIGTERM`.
`srv.Shutdown` stops accepting new connections and waits for in-flight requests to finish —
up to the 10-second deadline.

Test it:

```bash
PORT=3000 go run ./cmd/api
# listening on :3000

# Ctrl+C
# shutting down gracefully...
# server stopped
```

## Testing handlers

`net/http/httptest` lets you exercise handlers without starting a real server. You create
a request with `httptest.NewRequest`, pass it to a handler, and inspect the response through
`httptest.NewRecorder`.

### Testing the store

```go
// internal/store/memory_test.go
package store

import "testing"

func TestMemory_CreateAndGet(t *testing.T) {
    s := NewMemory()

    item := s.Create("Test Item", 29.99)
    if item.ID != "1" {
        t.Errorf("expected ID 1, got %s", item.ID)
    }
    if item.Name != "Test Item" {
        t.Errorf("expected Name 'Test Item', got %s", item.Name)
    }

    got, ok := s.Get("1")
    if !ok {
        t.Fatal("expected item to exist")
    }
    if got.ID != item.ID {
        t.Errorf("expected ID %s, got %s", item.ID, got.ID)
    }
}

func TestMemory_Delete(t *testing.T) {
    s := NewMemory()
    s.Create("Test Item", 9.99)

    if !s.Delete("1") {
        t.Error("expected delete to succeed")
    }

    _, ok := s.Get("1")
    if ok {
        t.Error("expected item to be gone")
    }
}
```

### Table-driven handler tests

```go
// internal/handlers/items_test.go
package handlers

import (
    "bytes"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/dhanifudin/go-api-demo/internal/store"

    "github.com/go-chi/chi/v5"
)

func TestList_Empty(t *testing.T) {
    s := store.NewMemory()
    h := NewItemHandler(s)

    req := httptest.NewRequest(http.MethodGet, "/items", nil)
    rec := httptest.NewRecorder()

    h.List(rec, req)

    if rec.Code != http.StatusOK {
        t.Fatalf("expected 200, got %d", rec.Code)
    }

    var items []store.Item
    json.NewDecoder(rec.Body).Decode(&items)

    if len(items) != 0 {
        t.Errorf("expected 0 items, got %d", len(items))
    }
}

func TestCreate_ValidRequest(t *testing.T) {
    s := store.NewMemory()
    h := NewItemHandler(s)

    body := bytes.NewBufferString(`{"name":"Widget","price":19.99}`)
    req := httptest.NewRequest(http.MethodPost, "/items", body)
    rec := httptest.NewRecorder()

    h.Create(rec, req)

    if rec.Code != http.StatusCreated {
        t.Fatalf("expected 201, got %d", rec.Code)
    }

    var item store.Item
    json.NewDecoder(rec.Body).Decode(&item)

    if item.Name != "Widget" {
        t.Errorf("expected Name 'Widget', got %s", item.Name)
    }
}

func TestCreate_InvalidJSON(t *testing.T) {
    s := store.NewMemory()
    h := NewItemHandler(s)

    body := bytes.NewBufferString(`not-json`)
    req := httptest.NewRequest(http.MethodPost, "/items", body)
    rec := httptest.NewRecorder()

    h.Create(rec, req)

    if rec.Code != http.StatusBadRequest {
        t.Fatalf("expected 400, got %d", rec.Code)
    }
}

func TestGet_NotFound(t *testing.T) {
    s := store.NewMemory()
    h := NewItemHandler(s)

    req := httptest.NewRequest(http.MethodGet, "/items/99", nil)

    // chi.URLParam reads from route context; simulate it
    rctx := chi.NewRouteContext()
    rctx.URLParams.Add("id", "99")
    req = req.WithContext(chi.RouteContext(req.Context(), rctx))

    rec := httptest.NewRecorder()
    h.Get(rec, req)

    if rec.Code != http.StatusNotFound {
        t.Fatalf("expected 404, got %d", rec.Code)
    }
}

func TestGet_Integration(t *testing.T) {
    s := store.NewMemory()
    h := NewItemHandler(s)

    // Create an item
    body := bytes.NewBufferString(`{"name":"Gadget","price":49.99}`)
    createReq := httptest.NewRequest(http.MethodPost, "/items", body)
    createRec := httptest.NewRecorder()
    h.Create(createRec, createReq)

    // Get it back
    getReq := httptest.NewRequest(http.MethodGet, "/items/1", nil)
    rctx := chi.NewRouteContext()
    rctx.URLParams.Add("id", "1")
    getReq = getReq.WithContext(chi.RouteContext(getReq.Context(), rctx))
    getRec := httptest.NewRecorder()
    h.Get(getRec, getReq)

    if getRec.Code != http.StatusOK {
        t.Fatalf("expected 200, got %d", getRec.Code)
    }

    var item store.Item
    json.NewDecoder(getRec.Body).Decode(&item)

    if item.Name != "Gadget" {
        t.Errorf("expected Name 'Gadget', got %s", item.Name)
    }
}
```

### Testing middleware

```go
// internal/middleware/middleware_test.go
package middleware

import (
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestRecovery_PanicCaught(t *testing.T) {
    handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        panic("something went wrong")
    })

    wrapped := Recovery(handler)

    req := httptest.NewRequest(http.MethodGet, "/", nil)
    rec := httptest.NewRecorder()

    // Should not panic
    wrapped.ServeHTTP(rec, req)

    if rec.Code != http.StatusInternalServerError {
        t.Errorf("expected 500, got %d", rec.Code)
    }
}

func TestRecovery_NoPanic(t *testing.T) {
    handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    })

    wrapped := Recovery(handler)

    req := httptest.NewRequest(http.MethodGet, "/", nil)
    rec := httptest.NewRecorder()

    wrapped.ServeHTTP(rec, req)

    if rec.Code != http.StatusOK {
        t.Errorf("expected 200, got %d", rec.Code)
    }
}
```

Run the test suite:

```bash
go test ./...
# ok   github.com/dhanifudin/go-api-demo/internal/handlers   0.012s
# ok   github.com/dhanifudin/go-api-demo/internal/middleware  0.008s
# ok   github.com/dhanifudin/go-api-demo/internal/store       0.005s
```

## Where to go next

You now have a complete, testable REST API built with Go — ready to containerise and deploy.
The natural next steps follow two paths:

### Containerise with Docker

The [Docker primer](/blog/containers-and-docker) shows how to package this exact API into a
multi-stage Docker image — compiling in an Alpine builder stage and copying the static binary
into a `FROM scratch` runtime image. The result is an ~8 MB container that starts in
milliseconds. The same post covers Docker Compose for local development, wiring the API to
PostgreSQL and Redis.

### Deploy to Kubernetes

The [Kubernetes for developers](/blog/kubernetes-for-developers) tutorial picks up where
Docker leaves off. It walks through translating the Compose stack into Kubernetes Deployments
and Services, adding readiness and liveness probes, extracting configuration into ConfigMaps
and Secrets, and performing rolling updates with zero downtime. The entire stack — API,
Postgres, Redis — runs on a local kind cluster.

### Extend the API

Beyond the tutorial, here are directions worth exploring:

- **Replace the in-memory store** with PostgreSQL via `database/sql` and `pgx`. Add migrations
  with [golang-migrate](https://github.com/golang-migrate/migrate).
- **Add authentication** — JWT-based auth with middleware that extracts claims from
  `Authorization: Bearer` headers and injects them into the request context.
- **Structured logging** — swap `log.Printf` for [slog](https://pkg.go.dev/log/slog)
  (Go 1.21+) with JSON output for log aggregation.
- **API documentation** — generate OpenAPI specs from Go types and annotations using
  [swaggo](https://github.com/swaggo/swag-go).
- **More chi middleware** — `chi` ships with `Timeout`, `Throttle`, `RealIP`, and `Compress`
  middleware. Check the [chi docs](https://go-chi.io/) for the full list.

The beauty of this stack is its simplicity. One binary, one module file, no generated code,
no framework magic. Everything you learned in this tutorial scales from a weekend project
to a production service.
