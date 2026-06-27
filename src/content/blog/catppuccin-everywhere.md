---
title: "Catppuccin: The colorscheme that follows me everywhere"
date: 2026-03-10
description: "From Neovim to the terminal to the browser — one palette to rule them all."
tags: ["catppuccin", "colorscheme", "design", "neovim"]
draft: false
---

## A colorscheme obsession

I've tried them all: Gruvbox, Nord, Tokyo Night, Dracula, Solarized. For years I bounced between
them until Catppuccin landed and I haven't looked back.

What makes it special? The palette isn't just _dark + accents_. It has four flavors spanning from
light to dark:

| Flavor   | Background | Character |
|----------|-----------|-----------|
| Latte    | #eff1f5   | Warm light, readable |
| Frappé   | #303446   | Muted dark |
| Macchiato| #24273a   | Deep dark |
| Mocha    | #1e1e2e   | The classic deep dark |

## Why it works on the web

Catppuccin was designed for terminals and editors but the palette translates beautifully to UI.
The semantic structure — `base`, `mantle`, `crust` for backgrounds; `surface0/1/2` for panels;
`overlay0/1/2` for subdued text — maps directly to a design system.

On this site, I use:
- `base` → editor background
- `mantle` → NeoTree sidebar, statusline
- `crust` → BufferLine tab strip
- `surface0` → active tab highlight, cursorline, input backgrounds
- `text` / `subtext1` → primary / secondary content
- `overlay0` → line numbers, key hints
- `blue` → accent, active items, links
- `mauve` → NeoTree header, H1
- `peach` → strong emphasis, which-key group labels

## The toggle

This site ships Latte (light) as the default — better for daytime reading. Toggle to Mocha with
`Space t` or the ◑ button in the status line. Your preference is stored in `localStorage`.

```typescript
// The toggle, in useLeader.ts
export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') ?? 'latte';
  const next = current === 'mocha' ? 'latte' : 'mocha';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('flavor', next);
}
```

The theme is applied before paint via an inline `<script>` in the layout `<head>`, so there's
no flash of unstyled content (FOUC).
