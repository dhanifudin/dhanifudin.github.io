---
title: "gRPC services in Go — from protobuf to production"
date: 2026-08-10
description: "Build a gRPC service in Go: define a contract with Protocol Buffers, generate stubs with buf, implement unary and streaming RPCs, layer in interceptors and status codes, and deploy it behind a Kubernetes Service."
tags: ["go", "backend", "grpc", "protobuf", "kubernetes", "microservices"]
series:
  id: from-go-api-to-kubernetes
  name: "From Go API to Kubernetes"
  order: 8
  description: "A practical progression from building REST APIs in Go through containerization with Docker to orchestration with Kubernetes."
draft: false
---

## Why gRPC for internal services

In the [REST API tutorial](/blog/building-rest-apis-with-go) we built a JSON-over-HTTP
API with `net/http` and `chi`. It is a great fit for browsers, mobile clients, and
public endpoints — JSON is human-readable and works everywhere. But when one backend
service calls another, that ubiquity starts to cost you:

- **No contract.** REST endpoints are defined by convention. Nothing stops two teams
  from drifting on field names, types, or semantics until a request fails at 3am.
- **Text on the wire.** JSON is a text format. Every message pays for serialisation
  overhead, and you hand-parse fields with struct tags.
- **Request/response only.** REST over HTTP/1.1 models one-shot calls. Streaming data
  or long-lived connections means WebSockets or SSE — two more protocols to learn.

gRPC is the de facto standard for service-to-service communication in cloud-native
backends. It gives you four things that a hand-rolled REST API does not:

- **Contract-first APIs.** You write a `.proto` schema and generate client and server
  code from it. The contract is a source file, reviewed in a PR, not a shared wiki page.
- **Protocol Buffers on the wire.** A compact, binary serialisation format — smaller
  and faster to encode/decode than JSON, with strict typing and backward-compatible
  schema evolution.
- **HTTP/2 transport.** Multiplexed requests over a single connection, header
  compression, and flow control — no six-connections-per-host limit.
- **Streaming built in.** Unary, server-streaming, client-streaming, and bidirectional
  streaming are first-class in the IDL, not bolted on.

For a lecturer or a cloud engineer, this matters because gRPC services are what you
actually deploy on Kubernetes and instrument with OpenTelemetry and Prometheus. This
tutorial completes the backend curriculum started by the REST and auth posts, and
bridges directly into the [Kubernetes](/blog/kubernetes-for-developers) and
[observability](/blog/observability-for-go-services) content already on this site.

## Defining a service with Protocol Buffers

Protocol Buffers (protobuf) is the interface definition language (IDL) for gRPC. You
describe *messages* (the data) and *services* (the operations) in a `.proto` file, then
compile it into Go code. We will reuse the same `items` domain from the REST tutorial so
the comparison is direct.

Create the project:

```bash
mkdir go-grpc-demo && cd go-grpc-demo
go mod init github.com/dhanifudin/go-grpc-demo
```

Define the contract:

```proto
// proto/items/v1/items.proto
syntax = "proto3";

package items.v1;

option go_package = "github.com/dhanifudin/go-grpc-demo/gen/items/v1;itemsv1";

import "google/protobuf/timestamp.proto";

service ItemsService {
  rpc GetItem(GetItemRequest) returns (GetItemResponse);
  rpc ListItems(ListItemsRequest) returns (ListItemsResponse);
  rpc CreateItem(CreateItemRequest) returns (CreateItemResponse);
  rpc WatchItems(WatchItemsRequest) returns (stream WatchItemsResponse);
  rpc UploadItems(stream UploadItemsRequest) returns (UploadItemsResponse);
  rpc SyncItems(stream SyncItemsRequest) returns (stream SyncItemsResponse);
}

message Item {
  string id = 1;
  string name = 2;
  double price = 3;
  google.protobuf.Timestamp created_at = 4;
}

message GetItemRequest {
  string id = 1;
}

message GetItemResponse {
  Item item = 1;
}

message ListItemsRequest {
  int32 page_size = 1;
  string page_token = 2;
}

message ListItemsResponse {
  repeated Item items = 1;
  string next_page_token = 2;
}

message CreateItemRequest {
  string name = 1;
  double price = 2;
}

message CreateItemResponse {
  Item item = 1;
}

message WatchItemsRequest {
  string prefix = 1;
}

message WatchItemsResponse {
  Item item = 1;
}

message UploadItemsRequest {
  string name = 1;
  double price = 2;
}

message UploadItemsResponse {
  int32 created = 1;
}

message SyncItemsRequest {
  string name = 1;
  double price = 2;
}

message SyncItemsResponse {
  Item item = 1;
}
```

Key design points:

- **Field numbers never change.** `= 1`, `= 2`, `= 3` are the wire identifiers. Renaming
  a field is free; renumbering it breaks every deployed client. Treat numbers as part of
  your public API.
- **`proto3` is the default.** Every field has a zero value (`""`, `0`, `false`), so you
  cannot distinguish "unset" from "empty" with a plain scalar — use `optional` or wrapper
  types when that matters.
- **`go_package` pins the import path.** It is a full import path plus a package alias
  (`;itemsv1`). Omitting it makes `protoc` refuse to generate code for recent plugin
  versions.
- **`package items.v1`** namespaces your types to avoid collisions, and becomes the
  service's fully-qualified name (`items.v1.ItemsService`) used by `grpcurl`.
- **Well-known types** like `google.protobuf.Timestamp` model time with nanosecond
  precision, mapping to `time.Time` in Go.

## Generating Go stubs with `protoc` and `buf`

Two tools can compile `.proto` files into Go: raw `protoc` with plugins, or `buf`, which
wraps `protoc` and adds linting, breaking-change detection, and a schema registry. We
will use `buf` because it enforces consistency across a team.

Install the plugins and `buf`:

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
go install github.com/bufbuild/buf/cmd/buf@latest
```

`buf` reads two config files. `buf.yaml` declares where your protos live and which lint
and breaking rules to enforce:

```yaml
# buf.yaml
version: v2
modules:
  - path: proto
lint:
  use:
    - STANDARD
breaking:
  use:
    - FILE
```

`buf.gen.yaml` declares the code-generation plugins and their output:

```yaml
# buf.gen.yaml
version: v2
plugins:
  - local: protoc-gen-go
    out: gen
    opt:
      - paths=source_relative
  - local: protoc-gen-go-grpc
    out: gen
    opt:
      - paths=source_relative
```

Now generate:

```bash
buf generate
```

This writes `gen/items/v1/items.pb.go` (messages, serialisation) and
`gen/items/v1/items_grpc.pb.go` (service and client interfaces) under `gen/`. The
`paths=source_relative` option mirrors the `proto/` directory layout instead of baking
your module path into the tree.

If you prefer the plain `protoc` route:

```bash
protoc \
  --go_out=gen --go_opt=paths=source_relative \
  --go-grpc_out=gen --go-grpc_opt=paths=source_relative \
  --proto_path=proto \
  proto/items/v1/items.proto
```

### Linting and breakage checks

`buf lint` flags naming and style violations. `buf breaking --against` compares your
schema against a previous revision to catch incompatible changes *before* they reach a
client. Run both in CI:

```bash
buf lint
buf breaking --against '.git#branch=main'
```

The generated code is not hand-edited. When the schema changes, regenerate and commit
the result — clients and servers then evolve from a single source of truth.

## Implementing a unary service and client

Start with the in-memory store, mirroring the REST tutorial's data layer:

```go
// internal/store/store.go
package store

import (
    "fmt"
    "sync"
    "time"
)

type Item struct {
    ID        string
    Name      string
    Price     float64
    CreatedAt time.Time
}

type Store struct {
    mu    sync.RWMutex
    items map[string]Item
    seq   int
}

func New() *Store {
    return &Store{items: make(map[string]Item)}
}

func (s *Store) List() []Item {
    s.mu.RLock()
    defer s.mu.RUnlock()

    items := make([]Item, 0, len(s.items))
    for _, item := range s.items {
        items = append(items, item)
    }
    return items
}

func (s *Store) Get(id string) (Item, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()

    item, ok := s.items[id]
    return item, ok
}

func (s *Store) Create(name string, price float64) Item {
    s.mu.Lock()
    defer s.mu.Unlock()

    s.seq++
    id := fmt.Sprintf("%d", s.seq)

    item := Item{
        ID:        id,
        Name:      name,
        Price:     price,
        CreatedAt: time.Now(),
    }
    s.items[id] = item
    return item
}
```

Now the service implementation. Note the `UnimplementedItemsServiceServer` embedding —
it is generated and provides default `Unimplemented` responses for every RPC, so adding
a new method to the proto does not break existing servers:

```go
// internal/server/server.go
package server

import (
    "context"

    itemsv1 "github.com/dhanifudin/go-grpc-demo/gen/items/v1"
    "github.com/dhanifudin/go-grpc-demo/internal/store"

    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
    "google.golang.org/protobuf/types/known/timestamppb"
)

type Server struct {
    itemsv1.UnimplementedItemsServiceServer
    store *store.Store
}

func New(s *store.Store) *Server {
    return &Server{store: s}
}

func toProto(item store.Item) *itemsv1.Item {
    return &itemsv1.Item{
        Id:        item.ID,
        Name:      item.Name,
        Price:     item.Price,
        CreatedAt: timestamppb.New(item.CreatedAt),
    }
}

func (s *Server) GetItem(ctx context.Context, req *itemsv1.GetItemRequest) (*itemsv1.GetItemResponse, error) {
    item, ok := s.store.Get(req.GetId())
    if !ok {
        return nil, status.Errorf(codes.NotFound, "item %q not found", req.GetId())
    }
    return &itemsv1.GetItemResponse{Item: toProto(item)}, nil
}

func (s *Server) ListItems(ctx context.Context, req *itemsv1.ListItemsRequest) (*itemsv1.ListItemsResponse, error) {
    items := s.store.List()
    out := make([]*itemsv1.Item, 0, len(items))
    for _, item := range items {
        out = append(out, toProto(item))
    }
    return &itemsv1.ListItemsResponse{Items: out}, nil
}

func (s *Server) CreateItem(ctx context.Context, req *itemsv1.CreateItemRequest) (*itemsv1.CreateItemResponse, error) {
    if req.GetName() == "" || req.GetPrice() <= 0 {
        return nil, status.Error(codes.InvalidArgument, "name and positive price are required")
    }
    item := s.store.Create(req.GetName(), req.GetPrice())
    return &itemsv1.CreateItemResponse{Item: toProto(item)}, nil
}
```

Notice the mapping from REST to gRPC semantics:

- `http.StatusNotFound` → `codes.NotFound`
- `http.StatusBadRequest` → `codes.InvalidArgument`

Error handling is covered in full below. For now, the key difference is that gRPC errors
are typed, structured values carried in the trailing headers — not strings in a JSON body.

Wire the server up:

```go
// cmd/server/main.go
package main

import (
    "log"
    "net"

    itemsv1 "github.com/dhanifudin/go-grpc-demo/gen/items/v1"
    "github.com/dhanifudin/go-grpc-demo/internal/server"
    "github.com/dhanifudin/go-grpc-demo/internal/store"

    "google.golang.org/grpc"
    "google.golang.org/grpc/reflection"
)

func main() {
    lis, err := net.Listen("tcp", ":50051")
    if err != nil {
        log.Fatalf("failed to listen: %v", err)
    }

    s := grpc.NewServer()
    itemsv1.RegisterItemsServiceServer(s, server.New(store.New()))

    reflection.Register(s)

    log.Println("listening on :50051")
    if err := s.Serve(lis); err != nil {
        log.Fatalf("failed to serve: %v", err)
    }
}
```

`reflection.Register(s)` exposes a server-reflection service that lets tools like
`grpcurl` discover your methods without a shared `.proto` file — invaluable during
development.

### A minimal client

```go
// cmd/client/main.go
package main

import (
    "context"
    "log"
    "time"

    itemsv1 "github.com/dhanifudin/go-grpc-demo/gen/items/v1"

    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
)

func main() {
    conn, err := grpc.NewClient("localhost:50051", grpc.WithTransportCredentials(insecure.NewCredentials()))
    if err != nil {
        log.Fatalf("did not connect: %v", err)
    }
    defer conn.Close()

    client := itemsv1.NewItemsServiceClient(conn)

    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()

    resp, err := client.CreateItem(ctx, &itemsv1.CreateItemRequest{Name: "Mechanical Keyboard", Price: 149.99})
    if err != nil {
        log.Fatalf("CreateItem: %v", err)
    }
    log.Printf("created item %s", resp.GetItem().GetId())
}
```

`grpc.NewClient` is the modern constructor (gRPC-Go 1.63+); `grpc.Dial` is the legacy
equivalent still seen in older code. Contexts and deadlines flow through every call —
`context.WithTimeout` here bounds the entire RPC.

Run the server and the client:

```bash
go mod tidy
go run ./cmd/server &
go run ./cmd/client
# 2026/08/10 09:00:00 created item 1
```

## Server and client interceptors

Interceptors are gRPC's answer to HTTP middleware. A unary interceptor wraps a single
`handler` function; a stream interceptor wraps the whole stream. You can chain them,
and each side (server and client) has its own chain.

### Logging interceptor

```go
// internal/interceptor/logging.go
package interceptor

import (
    "context"
    "log"
    "time"

    "google.golang.org/grpc"
    "google.golang.org/grpc/status"
)

func LoggingUnary(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
    start := time.Now()
    resp, err := handler(ctx, req)
    log.Printf("grpc %s -> %s (%s)",
        info.FullMethod,
        status.Code(err),
        time.Since(start).Round(time.Microsecond),
    )
    return resp, err
}
```

### Auth interceptor

The auth tutorial showed JWT middleware for HTTP. The gRPC analogue reads the same
`authorization` metadata from the incoming context:

```go
// internal/interceptor/auth.go
package interceptor

import (
    "context"

    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/metadata"
    "google.golang.org/grpc/status"
)

var validTokens = map[string]bool{
    "dev-token": true,
}

func AuthUnary(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
    md, ok := metadata.FromIncomingContext(ctx)
    if !ok {
        return nil, status.Error(codes.Unauthenticated, "missing metadata")
    }
    tokens := md.Get("authorization")
    if len(tokens) == 0 || !validTokens[tokens[0]] {
        return nil, status.Error(codes.Unauthenticated, "invalid token")
    }
    return handler(ctx, req)
}
```

Unlike HTTP, gRPC has no notion of a path you can exclude from auth — every method goes
through the interceptor. If you need public methods (e.g. a health check), use a
per-method skip list keyed by `info.FullMethod`, or rely on the separate health service.

### Metrics interceptor

Prometheus counters plug in exactly where you would expect:

```go
// internal/interceptor/metrics.go
package interceptor

import (
    "context"

    "github.com/prometheus/client_golang/prometheus"

    "google.golang.org/grpc"
    "google.golang.org/grpc/status"
)

var rpcTotal = prometheus.NewCounterVec(
    prometheus.CounterOpts{
        Name: "grpc_server_handled_total",
        Help: "Total number of RPCs handled by the gRPC server.",
    },
    []string{"method", "code"},
)

func init() {
    prometheus.MustRegister(rpcTotal)
}

func MetricsUnary(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
    resp, err := handler(ctx, req)
    rpcTotal.WithLabelValues(info.FullMethod, status.Code(err).String()).Inc()
    return resp, err
}
```

### Streaming interceptors

Streaming RPCs get their own interceptor type. The pattern is the same, but instead of
wrapping a handler you wrap a `grpc.ServerStream` so you can observe each message:

```go
// internal/interceptor/logging_stream.go
package interceptor

import (
    "log"

    "google.golang.org/grpc"
)

func LoggingStream(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
    log.Printf("grpc-stream %s (%s)", info.FullMethod, streamKind(info))
    return handler(srv, ss)
}

func streamKind(info *grpc.StreamServerInfo) string {
    if info.IsClientStream && info.IsServerStream {
        return "bidi"
    }
    if info.IsClientStream {
        return "client-stream"
    }
    return "server-stream"
}
```

### Client-side interceptors

Clients chain interceptors the same way, with the `grpc.WithUnaryInterceptor` and
`grpc.WithStreamInterceptor` dial options. A logging or retry interceptor on the client
side lets you observe outbound traffic without touching the server:

```go
conn, err := grpc.NewClient(
    "localhost:50051",
    grpc.WithTransportCredentials(insecure.NewCredentials()),
    grpc.WithUnaryInterceptor(loggingClientUnary),
)
```

### Wiring the chain

```go
s := grpc.NewServer(
    grpc.ChainUnaryInterceptor(
        interceptor.LoggingUnary,
        interceptor.AuthUnary,
        interceptor.MetricsUnary,
    ),
    grpc.ChainStreamInterceptor(
        interceptor.LoggingStream,
    ),
)
```

`grpc.ChainUnaryInterceptor` runs each interceptor in order, innermost first relative to
the handler. Put auth early so unauthenticated calls are rejected before they are logged
or counted as success. Note the auth interceptor above now blocks `grpcurl` unless you
send a token — the verification commands below show how.

## Streaming patterns

Streaming is where gRPC earns its keep over REST. Three shapes exist beyond plain unary.

### Server-side streaming

The server sends many responses for a single request — ideal for feeds, logs, or watch
semantics. `WatchItems` emits matching items on an interval:

```go
// internal/server/stream.go
package server

import (
    "strings"
    "time"

    itemsv1 "github.com/dhanifudin/go-grpc-demo/gen/items/v1"
)

func (s *Server) WatchItems(req *itemsv1.WatchItemsRequest, stream itemsv1.ItemsService_WatchItemsServer) error {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-stream.Context().Done():
            return stream.Context().Err()
        case <-ticker.C:
            for _, item := range s.store.List() {
                if req.GetPrefix() == "" || strings.HasPrefix(item.Name, req.GetPrefix()) {
                    if err := stream.Send(&itemsv1.WatchItemsResponse{Item: toProto(item)}); err != nil {
                        return err
                    }
                }
            }
        }
    }
}
```

The `stream.Context().Done()` branch is essential: when the client cancels, the context
cancels and you must return, otherwise the goroutine leaks and keeps sending into the
void.

### Client-side streaming

The client sends many requests and receives a single response — a batch upload:

```go
func (s *Server) UploadItems(stream itemsv1.ItemsService_UploadItemsServer) error {
    var created int
    for {
        req, err := stream.Recv()
        if err == io.EOF {
            return stream.SendAndClose(&itemsv1.UploadItemsResponse{Created: int32(created)})
        }
        if err != nil {
            return err
        }
        s.store.Create(req.GetName(), req.GetPrice())
        created++
    }
}
```

`io.EOF` from `Recv` signals the client is done sending; `SendAndClose` sends the final
response and closes the stream.

### Bidirectional streaming

Both sides send and receive independently, in any order — a two-way sync:

```go
func (s *Server) SyncItems(stream itemsv1.ItemsService_SyncItemsServer) error {
    for {
        req, err := stream.Recv()
        if err == io.EOF {
            return nil
        }
        if err != nil {
            return err
        }
        item := s.store.Create(req.GetName(), req.GetPrice())
        if err := stream.Send(&itemsv1.SyncItemsResponse{Item: toProto(item)}); err != nil {
            return err
        }
    }
}
```

A real bidirectional RPC would push sends and receives into separate goroutines and use
a channel to coordinate, but the shape above shows the core loop: read, process, write,
repeat until `io.EOF`.

## Error handling and gRPC status codes

gRPC errors are not HTTP status codes. They are a `code` plus a message, carried in the
trailing headers, and converted to typed errors in generated clients via
`status.Code(err)` and `status.FromError(err)`.

Map REST codes to gRPC codes with `google.golang.org/grpc/codes`:

| REST (HTTP)      | gRPC code         | Meaning |
|------------------|-------------------|---------|
| `400 Bad Request`| `InvalidArgument` | Caller sent bad data |
| `401 Unauthorized` | `Unauthenticated` | Missing/invalid credentials |
| `403 Forbidden`  | `PermissionDenied`| Valid credentials, no access |
| `404 Not Found`  | `NotFound`        | Resource does not exist |
| `409 Conflict`   | `AlreadyExists`   | Resource violates uniqueness |
| `429 Too Many`   | `ResourceExhausted` | Rate limit or quota |
| `500 Server Error` | `Internal`       | Unspecified server failure |
| `503 Unavailable` | `Unavailable`    | Service down or overloaded |
| `504 Timeout`    | `DeadlineExceeded` | RPC exceeded its deadline |

Three gotchas:

1. **Only return one code per RPC.** `status.Errorf` builds the whole response. Once you
   return an error, the RPC is done — there is no "partially successful" response body.
2. **Never leak internals.** `status.Errorf(codes.Internal, err.Error())` ships stack
   traces and file paths to clients. Log the detail server-side, send a generic message.
3. **Prefer `codes.Unavailable` for retryable failures.** gRPC clients have built-in
   retry policies that key off `Unavailable`, `ResourceExhausted`, and
   `Aborted` — returning the right code lets `grpc.WithDefaultServiceConfig` retry
   transparently.

The client-side check:

```go
import "google.golang.org/grpc/status"

resp, err := client.GetItem(ctx, &itemsv1.GetItemRequest{Id: "999"})
if err != nil {
    st := status.Convert(err)
    if st.Code() == codes.NotFound {
        log.Println("item not found")
        return
    }
    log.Fatalf("unexpected error: %v", err)
}
```

## Running and testing locally with `grpcurl`

`grpcurl` is the `curl` for gRPC. Install it and talk to a running server:

```bash
go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest
```

Start the server, then discover its surface (thanks to reflection):

```bash
grpcurl -plaintext localhost:50051 list
# grpc.reflection.v1.ServerReflection
# grpc.reflection.v1alpha.ServerReflection
# items.v1.ItemsService

grpcurl -plaintext localhost:50051 list items.v1.ItemsService
# items.v1.ItemsService.CreateItem
# items.v1.ItemsService.GetItem
# items.v1.ItemsService.ListItems
# items.v1.ItemsService.SyncItems
# items.v1.ItemsService.UploadItems
# items.v1.ItemsService.WatchItems
```

Because we enabled the auth interceptor, send the token as metadata:

```bash
grpcurl -plaintext \
  -H "authorization: dev-token" \
  -d '{"name":"Mechanical Keyboard","price":149.99}' \
  localhost:50051 items.v1.ItemsService/CreateItem
# {
#   "item": {
#     "id": "1",
#     "name": "Mechanical Keyboard",
#     "price": 149.99,
#     "createdAt": "2026-08-10T09:00:00Z"
#   }
# }
```

Verify error handling — omitting the token returns a typed `Unauthenticated` error, and a
missing ID returns `NotFound`:

```bash
grpcurl -plaintext localhost:50051 items.v1.ItemsService/GetItem
# ERROR:
#   Code: Unauthenticated
#   Message: invalid token

grpcurl -plaintext \
  -H "authorization: dev-token" \
  -d '{"id":"999"}' \
  localhost:50051 items.v1.ItemsService/GetItem
# ERROR:
#   Code: NotFound
#   Message: item "999" not found
```

Exercise the server-streaming RPC:

```bash
grpcurl -plaintext \
  -H "authorization: dev-token" \
  -d '{"prefix":"Mech"}' \
  localhost:50051 items.v1.ItemsService/WatchItems
# (a WatchItemsResponse is emitted every second; Ctrl+C to stop)
```

### Tests without `grpcurl`

For automated tests, the generated client can talk to a `bufconn` in-memory listener — no
real port needed:

```go
// internal/server/server_test.go
package server

import (
    "context"
    "net"
    "testing"

    itemsv1 "github.com/dhanifudin/go-grpc-demo/gen/items/v1"
    "github.com/dhanifudin/go-grpc-demo/internal/store"

    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/credentials/insecure"
    "google.golang.org/grpc/status"
    "google.golang.org/grpc/test/bufconn"
)

func newTestClient(t *testing.T) itemsv1.ItemsServiceClient {
    t.Helper()

    lis := bufconn.Listen(1024 * 1024)
    s := grpc.NewServer()
    itemsv1.RegisterItemsServiceServer(s, New(store.New()))
    go s.Serve(lis)
    t.Cleanup(s.Stop)

    conn, err := grpc.NewClient("bufnet",
        grpc.WithTransportCredentials(insecure.NewCredentials()),
        grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
            return lis.DialContext(ctx)
        }),
    )
    if err != nil {
        t.Fatalf("dial: %v", err)
    }
    t.Cleanup(func() { conn.Close() })

    return itemsv1.NewItemsServiceClient(conn)
}

func TestCreateAndGet(t *testing.T) {
    client := newTestClient(t)
    ctx := context.Background()

    created, err := client.CreateItem(ctx, &itemsv1.CreateItemRequest{Name: "Widget", Price: 19.99})
    if err != nil {
        t.Fatalf("CreateItem: %v", err)
    }

    got, err := client.GetItem(ctx, &itemsv1.GetItemRequest{Id: created.GetItem().GetId()})
    if err != nil {
        t.Fatalf("GetItem: %v", err)
    }
    if got.GetItem().GetName() != "Widget" {
        t.Errorf("expected Widget, got %s", got.GetItem().GetName())
    }
}

func TestGetItemNotFound(t *testing.T) {
    client := newTestClient(t)

    _, err := client.GetItem(context.Background(), &itemsv1.GetItemRequest{Id: "999"})
    if status.Code(err) != codes.NotFound {
        t.Fatalf("expected NotFound, got %v", err)
    }
}
```

Run the suite:

```bash
go test ./...
# ok   github.com/dhanifudin/go-grpc-demo/internal/server   0.014s
```

## Deploying behind a Kubernetes Service and ingress

The [Kubernetes tutorial](/blog/kubernetes-for-developers) walked through Deployments,
Services, probes, and ConfigMaps for a REST API. gRPC differs in three deployment details:
it speaks HTTP/2, its health checks need a dedicated endpoint, and ingress must terminate
TLS to speak gRPC to the backend.

### Health checks

A plain TCP probe confirms the port is open but not that the service is *ready* to serve.
Use `grpc-health-probe` against the standard `grpc.health.v1.Health` service. Register a
health server in your code:

```go
// cmd/server/main.go (additional)
import (
    "google.golang.org/grpc/health"
    healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

healthServer := health.NewServer()
healthServer.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
healthpb.RegisterHealthServer(s, healthServer)
```

The Deployment probes then call `grpc-health-probe`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: items-grpc
spec:
  replicas: 2
  selector:
    matchLabels:
      app: items-grpc
  template:
    metadata:
      labels:
        app: items-grpc
    spec:
      containers:
        - name: server
          image: ghcr.io/dhanifudin/go-grpc-demo:latest
          ports:
            - containerPort: 50051
              name: grpc
          livenessProbe:
            exec:
              command: ["/bin/grpc-health-probe", "-addr=:50051"]
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            exec:
              command: ["/bin/grpc-health-probe", "-addr=:50051"]
            initialDelaySeconds: 5
            periodSeconds: 10
```

The `grpc-health-probe` binary is a single static executable you copy into the image —
mirroring the multi-stage Docker build from the [Docker tutorial](/blog/containers-and-docker).

### Service

A headless or ClusterIP Service is enough for internal traffic — gRPC does not need the
HTTP routing an ingress provides for service-to-service calls:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: items-grpc
spec:
  selector:
    app: items-grpc
  ports:
    - name: grpc
      port: 50051
      targetPort: grpc
```

### Ingress

Exposing gRPC to the outside world requires HTTP/2 end-to-end and TLS termination at the
ingress. Most ingress controllers terminate TLS and speak HTTP/2 to the backend, but they
need to know the backend is gRPC. With NGINX Ingress this is a `grpc` annotation:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: items-grpc
  annotations:
    nginx.ingress.kubernetes.io/backend-protocol: "GRPC"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - grpc.example.com
      secretName: grpc-tls
  rules:
    - host: grpc.example.com
      http:
        paths:
          - path: /items.v1.ItemsService
            pathType: Prefix
            backend:
              service:
                name: items-grpc
                port:
                  number: 50051
```

The path matches the fully-qualified service name (`/items.v1.ItemsService`). Without
TLS, gRPC clients cannot use the default secure transport — either terminate TLS at the
ingress (the production answer) or use `grpc.WithTransportCredentials(insecure.NewCredentials())`
for cluster-internal, non-ingress traffic. For east-west traffic inside the mesh, keep it
simple: call the ClusterIP Service directly and leave TLS termination to a service mesh.

## Where to go next

You now have a contract-first gRPC service with unary and streaming RPCs, typed errors,
interceptors, tests, and a Kubernetes-ready deployment. The natural next steps:

- **Observability** — the [observability tutorial](/blog/observability-for-go-services)
  covers OpenTelemetry and Prometheus. gRPC has first-class OTel instrumentation
  (`otelgrpc`) and the metrics interceptor above plugs directly into the same Prometheus
  endpoint you already expose.
- **Service mesh** — for mTLS, traffic shifting, and retries across services, look at
  Istio or Linkerd. A mesh terminates TLS on your behalf and lets you drop the
  `insecure.NewCredentials()` from internal callers.
- **gRPC-gateway** — if you need both gRPC and REST from one service, generate a REST
  proxy from the same `.proto` with [grpc-gateway](https://github.com/grpc-ecosystem/grpc-gateway).
  Your browser clients get JSON while your internal clients keep the binary protocol.
- **Schema registry** — publish your protos to the [Buf Schema Registry](https://buf.build)
  so teams consume versioned, linted, breaking-change-checked contracts instead of copying
  `.proto` files around.

The series now spans **build → containerise → persist → orchestrate → automate →
observe → secure → contract-first services**. The REST API you started with `net/http`
is one interface to the same domain; this tutorial adds a second, and the two coexist
behind the same data layer. For internal, high-volume, machine-to-machine traffic, reach
for gRPC; for browser-facing JSON APIs, keep the REST handler. The decision is not
either/or — it is which interface fits each caller.
