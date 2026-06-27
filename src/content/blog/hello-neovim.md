---
title: "Hello, Neovim World"
date: 2026-01-15
description: "Why I rebuilt my personal site to look like Neovim — and why you might want to too."
tags: ["neovim", "astro", "webdev", "lazyvim"]
draft: false
---

## The idea

I spend most of my day inside Neovim. The muscle memory, the keybindings, the split panes — they
feel like a second skin. So when I rebuilt my personal site, I asked: _what if the site itself felt
like the editor?_

Not a gimmick. A genuine attempt to bring the **Neovim UX** — keyboard-first navigation,
minimal chrome, a colorscheme I'm obsessed with — to the browser.

## What it's built with

- [Astro](https://astro.build) for the static site framework (fast, content-first)
- [Vue 3](https://vuejs.org) for interactive islands (NeoTree, which-key, command palette)
- [Tailwind CSS v4](https://tailwindcss.com) via the Vite plugin
- [Catppuccin](https://github.com/catppuccin/catppuccin) theme (Latte / Mocha)
- [Fira Code](https://github.com/tonsky/FiraCode) for _everything_ — monospace all the way

## The key pieces

### Neo-tree sidebar
The left sidebar mirrors `neo-tree.nvim`: expandable directories, filetype icons, active file
highlighted with an accent border. Keyboard navigation with `j`/`k` and `Enter`.

### which-key popup
Press **Space** anywhere on the site. A popup appears listing available keybindings, exactly
like `which-key.nvim`. Press `g` to drill into the goto group: `h`/`a`/`b`/`p` jump to pages.

### Telescope command palette
`<leader>f` opens a fuzzy finder over all pages, blog posts, and projects. Type to filter;
`↑`/`↓` to move; `Enter` to open.

### lualine statusline
The bottom bar shows: mode pill → git branch → filename → filetype → theme flavor → clock.
The powerline diagonal separators are pure CSS `clip-path`.

## Try it

- Press `Space` to see the which-key popup
- Press `Space f` to open the command palette
- Press `Space t` to toggle Catppuccin Latte ↔ Mocha
- Press `Space e` to toggle the Neo-tree sidebar

The site is fully open source: [github.com/dhanifudin/dhanifudin.github.io](https://github.com/dhanifudin/dhanifudin.github.io).
