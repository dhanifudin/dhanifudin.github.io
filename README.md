# dhanifudin.github.io

Personal website for [Dian Hanifudin Subhi](https://dhanifudin.github.io) — styled to look and
feel like **Neovim** with the [LazyVim](https://www.lazyvim.org) distribution.

[![Deploy](https://github.com/dhanifudin/dhanifudin.github.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/dhanifudin/dhanifudin.github.io/actions/workflows/deploy.yml)

## The UI

The site mimics a full Neovim session:

| Neovim plugin | Web equivalent |
|---------------|----------------|
| neo-tree.nvim | Left sidebar: collapsible file explorer with `j`/`k` navigation |
| which-key.nvim | `Space` → bottom popup showing grouped keybindings |
| telescope.nvim | `Space f` → fuzzy finder over all pages + content |
| lualine.nvim | Bottom statusline: mode · branch · filename · filetype · clock |
| bufferline.nvim | Top tab strip: pages as open buffers |
| dashboard.nvim | Homepage: ASCII header + shortcut menu + stats footer |

**Theme:** [Catppuccin](https://github.com/catppuccin/catppuccin) — Latte (light, default) or
Mocha (dark). Toggle with `Space t` or the ◑ button in the statusline.

**Font:** [Fira Code](https://github.com/tonsky/FiraCode) for everything, including prose.

## Keyboard shortcuts

| Keys | Action |
|------|--------|
| `Space` | Open which-key popup |
| `Space f` | Open command palette (fuzzy find) |
| `Space e` | Toggle Neo-tree sidebar |
| `Space g h` | Go to dashboard |
| `Space g a` | Go to about |
| `Space g b` | Go to blog |
| `Space g p` | Go to projects |
| `Space b n` / `b p` | Next / previous buffer |
| `Space t` | Toggle Catppuccin Latte ↔ Mocha |
| `Space 1–4` | Jump to buffer by index |
| `j` / `k` | Move up/down in Neo-tree |

## Tech stack

- [Astro 7](https://astro.build) — static site generator, GitHub Pages output
- [Vue 3](https://vuejs.org) — interactive islands (`client:only="vue"`)
- [Tailwind CSS v4](https://tailwindcss.com) — via `@tailwindcss/vite`
- [Catppuccin](https://github.com/catppuccin/catppuccin) — CSS custom property palette
- [@fontsource/fira-code](https://fontsource.org/fonts/fira-code) — self-hosted monospace

## Local development

```bash
npm install

# Dev server (background mode)
astro dev --background
astro dev status   # check status
astro dev logs     # view output
astro dev stop     # stop server

# Production build (same as CI)
npm run build
npm run preview    # preview dist/
```

## Contributing

This site uses the **OpenCode IssueOps** workflow. You can suggest changes by opening an issue —
no local development required.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide including the `/plan` and `/build`
commands, required secrets, and access control.

### Required secrets for OpenCode (repo owner setup)

| Secret | Description |
|--------|-------------|
| `OPENCODE_GO_API_KEY` | OpenCode API key |
| `GH_WORKFLOW_PAT` | PAT with `repo` + `pull_requests` write |

Enable GitHub Pages in **Settings → Pages → Source: GitHub Actions**.
