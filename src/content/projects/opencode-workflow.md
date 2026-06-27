---
title: "OpenCode IssueOps Workflow"
description: "GitHub Actions workflow enabling AI-assisted contributions via /plan and /build issue comments."
repo: "https://github.com/dhanifudin/dhanifudin.github.io"
tags: ["github-actions", "opencode", "ai", "automation"]
featured: false
order: 2
---

## Overview

A GitHub Actions workflow (ported from [se-polinema](https://github.com/se-polinema/se-polinema.github.io))
that lets repository collaborators drive AI code generation via issue comments.

## How it works

1. Collaborator opens an issue describing a change
2. Collaborator (or owner) comments `/plan` → OpenCode reads the discussion and posts an
   implementation plan
3. After review, `/build` → OpenCode implements, builds, screenshots, and opens a PR

## Jobs

- **check-auth** — verifies the commenter is a repo collaborator or in the allowlist
- **plan** — calls `opencode github run` to generate a plan comment
- **build** — creates `opencode/issue-<N>` branch, implements, runs `npm run build`, opens PR
- **report-error** — comments error details on failure

## Configuration

Secrets needed in repo settings:
- `OPENCODE_GO_API_KEY`
- `GH_WORKFLOW_PAT` (repo + pull_requests write)

Variables (optional):
- `OPENCODE_PLAN_MODEL` (default: kimi-k2.7)
- `OPENCODE_BUILD_MODEL` (default: deepseek-v4-pro)
- `OPENCODE_ALLOWLIST` (comma-separated GitHub usernames)
