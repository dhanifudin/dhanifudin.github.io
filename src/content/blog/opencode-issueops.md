---
title: "OpenCode IssueOps: AI-assisted contributions via GitHub Issues"
date: 2026-02-20
description: "How this site accepts contributions through /plan and /build commands — no code required."
tags: ["opencode", "github-actions", "ai", "workflow"]
draft: false
---

## The contributor workflow

Most personal sites are closed systems — only the owner can change them. This one is different.
Anyone can open a GitHub issue, describe what they want, and let an AI agent plan and implement it.

The workflow is ported from [se-polinema/se-polinema.github.io](https://github.com/se-polinema/se-polinema.github.io),
adapted for a personal repo with collaborator-based access control.

## How it works

### 1. File an issue
Go to [Issues → New Issue](https://github.com/dhanifudin/dhanifudin.github.io/issues/new/choose) and
pick a template:

- **Bug report** — something looks wrong or broken
- **Content request** — suggest a new blog post topic, project to add, section to write

Be specific. The AI reads the full issue discussion, so context is everything.

### 2. Comment `/plan`
A collaborator (or the repo owner) comments `/plan` on the issue. OpenCode reads the discussion and
replies with a structured implementation plan. Review it; push back in the comments if needed.

### 3. Comment `/build`
Once the plan looks good, comment `/build`. OpenCode:
1. Creates a branch `opencode/issue-<N>`
2. Implements the approved plan
3. Runs `npm run build` to verify it compiles
4. Takes a screenshot of the changed pages
5. Opens a pull request with the diff and screenshots

### 4. Review the PR
The PR is just like any other. Review the diff, request changes via `/plan <feedback>` or
`/build <feedback>` on the PR, and merge when happy.

## Access control

The `/plan` and `/build` commands are gated: only repository **collaborators** (and the owner) can
trigger them. This prevents spam while keeping contributions open.

## What's needed to activate it

The workflow requires two GitHub secrets (set in repo Settings → Secrets):

- `OPENCODE_GO_API_KEY` — your OpenCode API key
- `GH_WORKFLOW_PAT` — a Personal Access Token with `repo` + `pull_requests` write

See [CONTRIBUTING.md](https://github.com/dhanifudin/dhanifudin.github.io/blob/main/CONTRIBUTING.md)
for the full setup guide.
