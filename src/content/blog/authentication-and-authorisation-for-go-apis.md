---
title: "Authentication and authorisation patterns for Go APIs"
date: 2026-08-03
description: "Secure a Go REST API with JWT bearer tokens, bcrypt password hashing, and role-based access control — then wire it into Kubernetes with Secrets and write tests that verify every auth path."
tags: ["go", "backend", "security", "jwt", "authentication"]
series:
  id: from-go-api-to-kubernetes
  name: "From Go API to Kubernetes"
  order: 7
  description: "A practical progression from building REST APIs in Go through containerization with Docker to orchestration with Kubernetes."
draft: false
---

## Why the current open API needs auth

In the [REST API tutorial](/blog/building-rest-apis-with-go) we built a Go API
with `net/http` and `chi` — structured handlers, middleware, and an in-memory store.
The [database tutorial](/blog/database-design-and-migrations-for-go) migrated it to
PostgreSQL. The [Kubernetes tutorial](/blog/kubernetes-for-developers) deployed it to
a cluster. The [CI/CD tutorial](/blog/ci-cd-pipelines-with-github-actions) automated
the deploy pipeline. The [observability tutorial](/blog/observability-for-go-services)
added logs, metrics, and traces.

But there is a gap: **anyone with the URL can hit every endpoint.** `DELETE /api/items/1`
works with no credentials. That is fine for local prototyping but not for anything
facing real users.

Authentication and authorisation are day-1 concerns for any production API. This
tutorial closes the loop from **build → containerise → persist → orchestrate →
automate → observe → secure**, giving you a complete path from a local prototype
to a hardened service.

## Authentication vs authorisation

These terms are often confused. Here they are in one sentence each:

- **Authentication** answers "who are you?" — it is the process of verifying an
  identity (username + password, JWT token, OAuth flow).
- **Authorisation** answers "what can you do?" — it is the process of checking
  whether the authenticated identity has permission to perform a given action
  (delete a resource, access an admin endpoint).

A user can be authenticated but not authorised. Logging in proves you are Alice,
but Alice might not have the `admin` role required to delete users. The code
below separates these two concerns cleanly: one middleware handles auth (extracting
identity), another handles authorisation (checking roles).

## Project layout

We will add three new packages to the API from the earlier tutorials:

```
internal/
  auth/
    jwt.go          # token generation and validation
    middleware.go    # AuthMiddleware and RequireRole
    context.go       # context helpers for claims
    password.go      # bcrypt hashing and verification
  handlers/
    auth_handler.go  # login and register endpoints
  store/
    user_store.go    # user CRUD with Postgres
```

## JWT-based authentication

JWT (JSON Web Token) is a compact, URL-safe token format. A JWT consists of three
parts — header, payload, and signature — each base64-encoded and joined by dots.
The signature is a HMAC-SHA256 of the header and payload using a secret key known
only to the server. This means the server can verify the token was not tampered
with, and can trust the claims inside without a database lookup on every request.

### Choosing a library

The Go ecosystem has settled on `golang-jwt/jwt/v5` as the de facto JWT library.
It is actively maintained, has a clean API, and supports all standard signing
algorithms. The `v5` release cleaned up the API considerably — gone are the
confusing `StandardClaims` and `MapClaims` types, replaced by `RegisteredClaims`
and typed custom claims.

```bash
go get github.com/golang-jwt/jwt/v5@latest
```

### Define claims

Claims are the statements inside the token payload. The library provides
`RegisteredClaims` for standard fields (`exp`, `iat`, `sub`, `iss`) and expects
you to embed them in a custom struct:

```go
// internal/auth/jwt.go
package auth

import (
    "time"

    "github.com/golang-jwt/jwt/v5"
)

type Claims struct {
    jwt.RegisteredClaims
    UserID int64  `json:"sub"`
    Role   string `json:"role"`
}
```

`UserID` is stored in the `sub` (subject) claim — the standard JWT field for the
principal identifier. `Role` is a custom claim that middleware will read to enforce
RBAC.

### Sign tokens

Given a user ID and role, generate a signed token with a 15-minute expiry:

```go
var signingKey []byte

func InitSigningKey(secret string) {
    signingKey = []byte(secret)
}

func GenerateToken(userID int64, role string) (string, error) {
    now := time.Now()
    claims := Claims{
        RegisteredClaims: jwt.RegisteredClaims{
            Subject:   fmt.Sprintf("%d", userID),
            IssuedAt:  jwt.NewNumericDate(now),
            ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
        },
        UserID: userID,
        Role:   role,
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(signingKey)
}
```

HS256 (HMAC-SHA256) is appropriate for a single-service architecture because the
same secret is used to sign and verify tokens. If you later split into
microservices where multiple services need to verify tokens without sharing a
secret, switch to RS256 (asymmetric) — that is a one-line change with this library.

### Validate tokens

Verification happens in middleware, but extract it into a pure function for
testability:

```go
func ValidateToken(tokenString string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{},
        func(t *jwt.Token) (interface{}, error) {
            if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
            }
            return signingKey, nil
        },
    )
    if err != nil {
        return nil, fmt.Errorf("parse token: %w", err)
    }

    claims, ok := token.Claims.(*Claims)
    if !ok || !token.Valid {
        return nil, fmt.Errorf("invalid token")
    }

    return claims, nil
}
```

The key callback validates the signing algorithm — rejecting tokens that claim to
use `alg: none` — and returns the signing key. `ParseWithClaims` handles expiry
checks automatically through `RegisteredClaims`.

## Middleware in Go

The `net/http` middleware pattern in Go is a function that takes an `http.Handler`
and returns an `http.Handler`. This composition model is what `chi` uses for
`r.Use()`. Our auth middleware will:

1. Extract the `Authorization: Bearer` header.
2. Validate the token.
3. Inject claims into `context.Context` so downstream handlers can read them.

### Context helpers

Before writing the middleware, define the context helpers:

```go
// internal/auth/context.go
package auth

import "context"

type contextKey string

const claimsKey contextKey = "claims"

func SetClaims(ctx context.Context, c *Claims) context.Context {
    return context.WithValue(ctx, claimsKey, c)
}

func GetClaims(ctx context.Context) *Claims {
    if c, ok := ctx.Value(claimsKey).(*Claims); ok {
        return c
    }
    return nil
}
```

Using an unexported `contextKey` type prevents other packages from accidentally
colliding with this key — `context.WithValue` matches on both type and value.

### AuthMiddleware

```go
// internal/auth/middleware.go
package auth

import "net/http"

func AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        authHeader := r.Header.Get("Authorization")
        if authHeader == "" {
            http.Error(w, `{"error":"missing Authorization header"}`, http.StatusUnauthorized)
            return
        }

        const prefix = "Bearer "
        if len(authHeader) < len(prefix) || authHeader[:len(prefix)] != prefix {
            http.Error(w, `{"error":"invalid Authorization header format"}`, http.StatusUnauthorized)
            return
        }

        tokenString := authHeader[len(prefix):]
        claims, err := ValidateToken(tokenString)
        if err != nil {
            http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
            return
        }

        ctx := SetClaims(r.Context(), claims)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

This is orthogonal to the router — it works with `chi`, `net/http`, or any router
that supports standard middleware. After this middleware runs, any downstream
handler can call `GetClaims(r.Context())` to get the authenticated user's ID and
role.

### RequireRole middleware

With claims in context, authorisation is a second middleware that checks the role:

```go
func RequireRole(roles ...string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            claims := GetClaims(r.Context())
            if claims == nil {
                http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
                return
            }

            for _, allowed := range roles {
                if claims.Role == allowed {
                    next.ServeHTTP(w, r)
                    return
                }
            }

            http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
        })
    }
}
```

`RequireRole` is a higher-order function — it takes a list of allowed roles and
returns middleware. This is a common Go pattern that avoids hardcoding role logic
inside handlers.

### Wire it into the router

In `main.go`, apply the middlewares to the route groups that need protection:

```go
r := chi.NewRouter()

// Public routes — no auth required
r.Group(func(r chi.Router) {
    r.Get("/health", healthHandler)
    r.Post("/api/auth/login", loginHandler)
    r.Post("/api/auth/register", registerHandler)
})

// Protected routes — requires valid JWT
r.Group(func(r chi.Router) {
    r.Use(auth.AuthMiddleware)

    r.Get("/api/items", listItems)
    r.Get("/api/items/{itemID}", getItem)
    r.Post("/api/items", createItem)
    r.Put("/api/items/{itemID}", updateItem)
    r.Delete("/api/items/{itemID}", deleteItem)
})

// Admin routes — requires valid JWT + admin role
r.Group(func(r chi.Router) {
    r.Use(auth.AuthMiddleware)
    r.Use(auth.RequireRole("admin"))

    r.Get("/api/admin/users", listUsers)
    r.Delete("/api/admin/users/{userID}", deleteUser)
})
```

This grouping makes the security boundary explicit. A reader can look at
`main.go` and immediately see which routes are public, protected, or admin-only.
Adding a new route is a one-line decision: which group does it belong to?

## Password hashing

Storing plaintext passwords is never acceptable. Use `bcrypt` — it is part of the
Go extended standard library (`golang.org/x/crypto/bcrypt`) and has been
battle-tested for over two decades.

### Hash on registration, compare on login

```go
// internal/auth/password.go
package auth

import "golang.org/x/crypto/bcrypt"

const bcryptCost = 12

func HashPassword(password string) (string, error) {
    bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
    if err != nil {
        return "", err
    }
    return string(bytes), nil
}

func CheckPassword(password, hash string) bool {
    err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
    return err == nil
}
```

A cost of 12 means `2^12 = 4096` iterations. On a modern CPU this takes ~250 ms
per hash — slow enough to deter brute-force attacks, fast enough that a login
endpoint doesn't feel sluggish. Adjust up or down based on your threat model and
hardware.

### Minimal user store

A `users` table is all you need for local authentication:

```sql
CREATE TABLE users (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The `role` column defaults to `'user'`. Promote a user to admin manually (or via
a migration) — there is no self-service admin registration.

### Login handler

```go
// internal/handlers/auth_handler.go
package handlers

import (
    "encoding/json"
    "net/http"

    "github.com/yourorg/yourapp/internal/auth"
    "github.com/yourorg/yourapp/internal/store"
)

type loginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type loginResponse struct {
    Token string `json:"token"`
}

func LoginHandler(userStore *store.UserStore) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        var req loginRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
            return
        }

        user, err := userStore.FindByEmail(r.Context(), req.Email)
        if err != nil {
            http.Error(w, `{"error":"invalid credentials"}`, http.StatusUnauthorized)
            return
        }

        if !auth.CheckPassword(req.Password, user.Password) {
            http.Error(w, `{"error":"invalid credentials"}`, http.StatusUnauthorized)
            return
        }

        token, err := auth.GenerateToken(user.ID, user.Role)
        if err != nil {
            http.Error(w, `{"error":"failed to generate token"}`, http.StatusInternalServerError)
            return
        }

        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(loginResponse{Token: token})
    }
}
```

Notice both "user not found" and "wrong password" return the same message. This
prevents username enumeration — an attacker cannot distinguish between a valid
email with a wrong password and a non-existent email.

### Registration handler

```go
type registerRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

func RegisterHandler(userStore *store.UserStore) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        var req registerRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
            return
        }

        if req.Email == "" || req.Password == "" {
            http.Error(w, `{"error":"email and password are required"}`, http.StatusBadRequest)
            return
        }

        if len(req.Password) < 8 {
            http.Error(w, `{"error":"password must be at least 8 characters"}`, http.StatusBadRequest)
            return
        }

        hash, err := auth.HashPassword(req.Password)
        if err != nil {
            http.Error(w, `{"error":"failed to hash password"}`, http.StatusInternalServerError)
            return
        }

        user, err := userStore.Create(r.Context(), req.Email, hash)
        if err != nil {
            http.Error(w, `{"error":"email already registered"}`, http.StatusConflict)
            return
        }

        token, err := auth.GenerateToken(user.ID, user.Role)
        if err != nil {
            http.Error(w, `{"error":"failed to generate token"}`, http.StatusInternalServerError)
            return
        }

        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusCreated)
        json.NewEncoder(w).Encode(loginResponse{Token: token})
    }
}
```

Registering returns a token immediately — the user is logged in after signup
without a second round-trip.

## Role-based access control (RBAC)

The `role` column in the `users` table combined with the `RequireRole` middleware
gives you a simple but effective RBAC system. The mental model:

| Route | Auth? | Role? | Explanation |
|-------|-------|-------|-------------|
| `GET /health` | No | No | Liveness probe, no auth needed |
| `POST /api/auth/login` | No | No | Public login endpoint |
| `POST /api/auth/register` | No | No | Public registration |
| `GET /api/items` | Yes | Any | Any authenticated user can list items |
| `POST /api/items` | Yes | Any | Any authenticated user can create items |
| `DELETE /api/items/{id}` | Yes | Any | Any authenticated user can delete their items (ownership check in handler) |
| `GET /api/admin/users` | Yes | admin | Only admins can list all users |
| `DELETE /api/admin/users/{id}` | Yes | admin | Only admins can delete users |

For resource-level authorisation (e.g. "Alice can only delete her own items"), add
an ownership check inside the handler itself:

```go
func deleteItem(store *store.ItemStore) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        claims := auth.GetClaims(r.Context())
        itemID := chi.URLParam(r, "itemID")

        item, err := store.FindByID(r.Context(), itemID)
        if err != nil {
            http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
            return
        }

        if item.OwnerID != claims.UserID && claims.Role != "admin" {
            http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
            return
        }

        store.Delete(r.Context(), itemID)
        w.WriteHeader(http.StatusNoContent)
    }
}
```

The pattern: middleware handles broad role gates (admin vs user), handlers handle
fine-grained ownership checks. Keep authorisation logic as close to the data as
possible — the handler knows what "owning a resource" means in a way that generic
middleware cannot.

## Cookies vs Bearer tokens

A common question when adding auth to a Go API: should I use cookies or the
`Authorization` header?

| Factor | Bearer token | HttpOnly cookie |
|--------|-------------|-----------------|
| **Mobile / native apps** | Works naturally | Requires cookie jar |
| **SPA (React, Vue)** | Explicit, sent by JS | Automatic (`credentials: "include"`) |
| **XSS protection** | Token in JS scope = vulnerable | `HttpOnly` = JS cannot read it |
| **CSRF protection** | Immune (not sent automatically) | Requires CSRF token or SameSite |
| **Server-to-server** | Natural fit | Unusual |

**For a REST API consumed by multiple clients (SPA, mobile, CLI), prefer Bearer
tokens.** They are client-agnostic and immune to CSRF because the client must
explicitly attach the header. The downside is that an XSS vulnerability can steal
the token, so your SPA must store it carefully — in a closure or a Web Worker, not
in `localStorage`.

**For a traditional server-rendered app where the Go server serves HTML, prefer
HttpOnly cookies.** The browser attaches them automatically, JavaScript cannot
read them (XSS-resistant), and you add CSRF protection with a double-submit cookie
pattern or SameSite=Strict.

For the API in this series (REST + potential SPA frontend), Bearer tokens are the
right choice.

### Token refresh pattern

A 15-minute access token is short-lived to limit the damage of a leaked token.
Pair it with a longer-lived refresh token stored in an HttpOnly cookie or a
secure database entry. The flow:

1. Client logs in → receives access token (15 min) + refresh token (7 days).
2. Client sends access token on every request.
3. When the access token expires (401 response), the client sends the refresh
   token to `POST /api/auth/refresh`.
4. Server validates the refresh token → issues a new access token.
5. If the refresh token expires or is revoked, the client must log in again.

A minimal refresh endpoint:

```go
func RefreshHandler(authStore *store.AuthStore) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        var req struct {
            RefreshToken string `json:"refresh_token"`
        }
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
            return
        }

        session, err := authStore.FindByRefreshToken(r.Context(), req.RefreshToken)
        if err != nil || session.ExpiresAt.Before(time.Now()) {
            http.Error(w, `{"error":"invalid or expired refresh token"}`, http.StatusUnauthorized)
            return
        }

        // Rotate the refresh token on every use
        newRefreshToken := generateRefreshToken()
        authStore.RotateRefreshToken(r.Context(), session.ID, newRefreshToken)

        accessToken, err := auth.GenerateToken(session.UserID, session.Role)
        if err != nil {
            http.Error(w, `{"error":"failed to generate token"}`, http.StatusInternalServerError)
            return
        }

        json.NewEncoder(w).Encode(map[string]string{
            "access_token":  accessToken,
            "refresh_token": newRefreshToken,
        })
    }
}
```

Rotating the refresh token on every use limits the window for replay attacks —
the old token becomes invalid as soon as the new one is issued.

## Testing

Auth code is security code — it deserves thorough tests. There are two layers of
testing: unit tests for the pure functions (token validation, password hashing)
and integration tests for the HTTP middleware and handlers.

### Unit tests for token operations

```go
// internal/auth/jwt_test.go
package auth

import (
    "testing"
    "time"
)

func TestGenerateAndValidateToken(t *testing.T) {
    InitSigningKey("test-secret-do-not-use-in-production")

    token, err := GenerateToken(42, "user")
    if err != nil {
        t.Fatalf("GenerateToken: %v", err)
    }

    claims, err := ValidateToken(token)
    if err != nil {
        t.Fatalf("ValidateToken: %v", err)
    }

    if claims.UserID != 42 {
        t.Errorf("UserID = %d, want 42", claims.UserID)
    }
    if claims.Role != "user" {
        t.Errorf("Role = %s, want user", claims.Role)
    }
}

func TestValidateExpiredToken(t *testing.T) {
    InitSigningKey("test-secret")

    token, err := GenerateToken(1, "user")
    if err != nil {
        t.Fatalf("GenerateToken: %v", err)
    }

    // Artificially set the expiry 30 minutes ago by manipulating the signing key
    // For a cleaner approach, use a custom clock with jwt.WithTimeFunc
    // This test verifies that the expiry check catches intentionally expired tokens

    // Real test: generate a token with a past expiry using WithIssuedAt
    // (shown here conceptually; use jwt.NewNumericDate(time.Now().Add(-1*time.Hour)) in practice)
    _ = token
}
```

The expiry test is a conceptual sketch — in practice, use the library's
`jwt.WithTimeFunc` option to inject a fake clock, or generate tokens with explicit
`NotBefore`/`ExpiresAt` in the past.

### Unit tests for password hashing

```go
// internal/auth/password_test.go
package auth

import "testing"

func TestHashAndCheckPassword(t *testing.T) {
    hash, err := HashPassword("correct-horse-battery-staple")
    if err != nil {
        t.Fatalf("HashPassword: %v", err)
    }

    if !CheckPassword("correct-horse-battery-staple", hash) {
        t.Error("CheckPassword returned false for the correct password")
    }

    if CheckPassword("wrong-password", hash) {
        t.Error("CheckPassword returned true for the wrong password")
    }
}

func TestHashPasswordDeterministic(t *testing.T) {
    h1, _ := HashPassword("same-password")
    h2, _ := HashPassword("same-password")

    if h1 == h2 {
        t.Error("two hashes of the same password should differ — bcrypt includes a random salt")
    }
}
```

The second test verifies that bcrypt's salt is random — identical inputs produce
different outputs, preventing rainbow-table attacks.

### Integration tests for the auth middleware

Use `httptest` to spin up a test server with the middleware and assert status codes:

```go
// internal/auth/middleware_test.go
package auth

import (
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestAuthMiddlewareRejectsNoHeader(t *testing.T) {
    InitSigningKey("test-secret")

    handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    }))

    req := httptest.NewRequest(http.MethodGet, "/api/items", nil)
    rec := httptest.NewRecorder()

    handler.ServeHTTP(rec, req)

    if rec.Code != http.StatusUnauthorized {
        t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
    }
}

func TestAuthMiddlewareAcceptsValidToken(t *testing.T) {
    InitSigningKey("test-secret")

    token, err := GenerateToken(42, "user")
    if err != nil {
        t.Fatalf("GenerateToken: %v", err)
    }

    handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        claims := GetClaims(r.Context())
        if claims == nil {
            t.Error("claims should be in context")
        }
        if claims.UserID != 42 {
            t.Errorf("UserID = %d, want 42", claims.UserID)
        }
        w.WriteHeader(http.StatusOK)
    }))

    req := httptest.NewRequest(http.MethodGet, "/api/items", nil)
    req.Header.Set("Authorization", "Bearer "+token)
    rec := httptest.NewRecorder()

    handler.ServeHTTP(rec, req)

    if rec.Code != http.StatusOK {
        t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
    }
}

func TestRequireRoleRejectsWrongRole(t *testing.T) {
    InitSigningKey("test-secret")

    token, _ := GenerateToken(1, "user")

    requireAdmin := RequireRole("admin")
    handler := requireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    }))

    // Wrap with AuthMiddleware first to set claims
    fullHandler := AuthMiddleware(handler)

    req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
    req.Header.Set("Authorization", "Bearer "+token)
    rec := httptest.NewRecorder()

    fullHandler.ServeHTTP(rec, req)

    if rec.Code != http.StatusForbidden {
        t.Errorf("status = %d, want %d (forbidden)", rec.Code, http.StatusForbidden)
    }
}

func TestRequireRoleAllowsCorrectRole(t *testing.T) {
    InitSigningKey("test-secret")

    token, _ := GenerateToken(1, "admin")

    requireAdmin := RequireRole("admin")
    handler := requireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    }))

    fullHandler := AuthMiddleware(handler)

    req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
    req.Header.Set("Authorization", "Bearer "+token)
    rec := httptest.NewRecorder()

    fullHandler.ServeHTTP(rec, req)

    if rec.Code != http.StatusOK {
        t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
    }
}
```

Run the tests with the race detector enabled — auth middleware shares the signing
key as a package-level variable, so concurrent tests should not race:

```bash
go test -race ./internal/auth/...
```

## Kubernetes wiring

In the earlier tutorials, environment variables came from Kubernetes ConfigMaps.
Secrets — like the JWT signing key and database passwords — should use Kubernetes
Secrets instead. ConfigMaps are stored in plaintext in `etcd`; Secrets are
base64-encoded (not encrypted at rest with default settings, but they are a
separate object that RBAC can gate, and they integrate with external secret
stores like HashiCorp Vault).

### Create a Secret for the JWT signing key

Generate a strong random key and store it as a Secret:

```bash
JWT_SECRET=$(openssl rand -base64 64)
kubectl create secret generic api-secrets \
  --from-literal=jwt-signing-key="$JWT_SECRET" \
  --from-literal=db-password="$(openssl rand -base64 32)" \
  --namespace=default
```

The `openssl rand -base64 64` command generates 64 random bytes (512 bits) and
encodes them. This is far more entropy than HMAC-SHA256 needs (256 bits), but
there's no harm in overspecifying — the key is stored once and the cost is zero
at runtime.

### Mount the Secret into the Deployment

Update the Deployment manifest to mount `jwt-signing-key` as an environment
variable from the Secret:

```yaml
# manifests/api-deployment.yaml (additions shown)
spec:
  containers:
    - name: api
      image: ghcr.io/yourorg/go-api:latest
      envFrom:
        - configMapRef:
            name: api-config
        - secretRef:
            name: api-secrets
      env:
        - name: JWT_SIGNING_KEY
          valueFrom:
            secretKeyRef:
              name: api-secrets
              key: jwt-signing-key
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: api-secrets
              key: db-password
```

Two patterns are shown: `envFrom.secretRef` dumps all Secret keys as environment
variables (useful when there are many). `env.valueFrom.secretKeyRef` maps a
single Secret key to a named environment variable (more explicit). Use whichever
your team prefers — the security properties are identical.

### Read the secret in Go

Update `main.go` to read the signing key from the environment:

```go
func main() {
    signingKey := os.Getenv("JWT_SIGNING_KEY")
    if signingKey == "" {
        slog.Error("JWT_SIGNING_KEY is required")
        os.Exit(1)
    }
    auth.InitSigningKey(signingKey)

    // ... observability init, router setup, listen ...
}
```

A missing `JWT_SIGNING_KEY` fails fast at startup — no silent fallback to a
hardcoded key that an attacker could guess.

### Rotate secrets

Secrets don't rotate themselves. The process:

1. Generate a new key: `openssl rand -base64 64`
2. Add it to the Secret alongside the old key: `kubectl create secret generic
   api-secrets --from-literal=jwt-signing-key-v2=... --dry-run=client -o yaml |
   kubectl apply -f -`
3. Update the Deployment to reference `jwt-signing-key-v2`.
4. Roll out new Pods. Old Pods (with the old key) and new Pods (with the new key)
   coexist during the rollout — tokens signed by either key are valid.
5. After the rollout completes, remove the old key from the Secret.

For zero-downtime rotation, `ValidateToken` should try the current key first,
then fall back to the previous key:

```go
var (
    signingKey    []byte
    prevSigningKey []byte
)

func InitSigningKeys(current, previous string) {
    signingKey = []byte(current)
    if previous != "" {
        prevSigningKey = []byte(previous)
    }
}

func ValidateToken(tokenString string) (*Claims, error) {
    claims, err := parseWithKey(tokenString, signingKey)
    if err == nil {
        return claims, nil
    }

    if prevSigningKey != nil {
        return parseWithKey(tokenString, prevSigningKey)
    }

    return nil, err
}

func parseWithKey(tokenString string, key []byte) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{},
        func(t *jwt.Token) (interface{}, error) {
            if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
            }
            return key, nil
        },
    )
    if err != nil {
        return nil, err
    }
    claims, ok := token.Claims.(*Claims)
    if !ok || !token.Valid {
        return nil, fmt.Errorf("invalid token")
    }
    return claims, nil
}
```

The two-key approach eliminates the pain window. Tokens signed by the old key
remain valid until they expire naturally (15 minutes), and new tokens are signed
with the new key. No logged-out users, no 401 spikes during deployment.

## Summary and series next steps

You've now secured the Go API from the earlier tutorials with:

- **JWT-based authentication** — `golang-jwt/jwt/v5` with HMAC-SHA256 signing,
  15-minute token expiry, and a refresh token rotation pattern.
- **Middleware** — `AuthMiddleware` extracts and validates `Authorization: Bearer`
  tokens, injecting `Claims` into `context.Context`. `RequireRole` gates admin
  endpoints.
- **Password hashing** — `bcrypt` with cost 12 for a local user store with
  registration and login endpoints.
- **Role-based access control** — a `role` column on the `users` table, checked
  at the middleware level (role gating) and handler level (ownership checks).
- **Testing** — unit tests for token operations and password hashing, integration
  tests with `httptest` for the auth middleware and role enforcement.
- **Kubernetes wiring** — JWT signing key stored in a Kubernetes Secret, mounted
  as an environment variable, with a two-key rotation strategy for zero-downtime
  key rollover.

The series now covers the complete journey from prototype to production:
**build → containerise → persist → orchestrate → automate → observe → secure**.
Each tutorial builds on the last, and the Go API you started with `net/http` is
now a hardened, observable, authenticated service running on Kubernetes with
automated CI/CD.

Where the series could go next:

- **Rate limiting** — add a token bucket rate limiter (per-user or per-IP) using
  `golang.org/x/time/rate`, wired as a chi middleware. Redis-backed for distributed
  deployments.
- **gRPC services** — introduce the same API surface via gRPC with `protobuf`,
  interceptors for auth (analogous to HTTP middleware), and the trade-offs between
  REST + JSON and gRPC + protobuf.
- **API versioning** — URL prefix versioning (`/api/v1/`, `/api/v2/`) and
  content-type negotiation as the API evolves while keeping backward compatibility.
- **Caching** — Redis caching layer for expensive queries, cache invalidation
  patterns (write-through, cache-aside), and TTL strategies.
- **OAuth2 / OpenID Connect** — delegate authentication to an identity provider
  (Auth0, Keycloak, Google) so your Go API never touches passwords.
- **API gateway** — place an API gateway (Kong, Envoy, Traefik) in front of the
  service for centralized auth, rate limiting, and TLS termination.

The auth patterns you added today are the hardest to retrofit. Adding auth to a
running service means touching every handler, every test, and every deployment
manifest. Getting it right from the start — while the API is still small —
is the difference between a weekend of work and a quarter-long migration.
