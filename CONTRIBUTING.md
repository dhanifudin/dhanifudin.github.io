# Contributing to dhanifudin.github.io

This site accepts contributions via GitHub Issues using the **OpenCode IssueOps** workflow —
no local development setup required.

---

## How to contribute

### 1. Open an issue

Go to [Issues → New Issue](https://github.com/dhanifudin/dhanifudin.github.io/issues/new/choose)
and choose a template:

- **Bug Report** — something looks broken, a keybinding doesn't work, layout issues, etc.
- **Content Request** — suggest a new blog post, project to add, or section to write

Be as specific as possible. The AI reads the full issue discussion, so detail matters.

### 2. `/plan` — generate an implementation plan

A repository collaborator (or the owner) will comment `/plan` on your issue. OpenCode reads
the discussion and replies with a detailed implementation plan.

Review the plan. If something needs clarification or adjustment, add comments to the issue. The
collaborator can re-run `/plan <feedback>` to refine it.

### 3. `/build` — implement the plan

Once the plan looks good, a collaborator comments `/build`. OpenCode:

1. Creates a branch `opencode/issue-<N>`
2. Implements the plan
3. Runs `npm run build` to verify the site compiles
4. Opens a Pull Request with the diff

The PR is linked back to the issue automatically.

### 4. Review the PR

Review the diff, leave comments, and request changes if needed. Collaborators can run
`/plan <feedback>` or `/build <feedback>` on the PR to iterate without opening a new issue.

---

## Access control

The `/plan` and `/build` commands are gated to:
- Repository **owner** (dhanifudin)
- Repository **collaborators**
- Users listed in the `OPENCODE_ALLOWLIST` repository variable (comma-separated GitHub usernames)

This prevents spam while keeping contributions open.

---

## Repository setup (owner reference)

To activate the OpenCode IssueOps workflow, add these in **Settings → Secrets and variables**:

### Secrets (Settings → Secrets → Actions)

| Secret | Description |
|--------|-------------|
| `OPENCODE_GO_API_KEY` | Your OpenCode API key (from opencode.ai) |
| `GH_WORKFLOW_PAT` | GitHub Personal Access Token with `repo` + `pull_requests` write |

### Variables (Settings → Variables → Actions)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_PLAN_MODEL` | kimi-k2.7 | Model for `/plan` |
| `OPENCODE_BUILD_MODEL` | deepseek-v4-pro | Model for `/build` |
| `OPENCODE_ALLOWLIST` | _(empty)_ | Comma-separated GitHub usernames with access |

### GitHub Pages

Enable Pages in **Settings → Pages** with source: **GitHub Actions**.

---

## Local development

```bash
# Install dependencies
npm install

# Start dev server (background mode per AGENTS.md)
astro dev --background
astro dev status   # check running
astro dev logs     # view output
astro dev stop     # stop server

# Build for production (same command the CI runs)
npm run build
```

The site is at `http://localhost:4321` by default.

---

## Code conventions

See [AGENTS.md](./AGENTS.md) for the conventions that OpenCode follows when implementing changes.
The same conventions apply to manual contributions.
