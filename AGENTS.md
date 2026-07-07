## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

---

## Project conventions (OpenCode must follow these)

### Tech stack

- **Astro 7** (static, no SSR adapter needed for GitHub Pages)
- **Vue 3** with `<script setup lang="ts">` — all interactive widgets
- **Tailwind CSS v4** via `@tailwindcss/vite` (Vite plugin, not the old `@astrojs/tailwind`)
- **@fontsource/fira-code** — monospace font imported in `src/styles/global.css`
- **Catppuccin** colors via CSS custom properties (see `src/styles/global.css`)
- Content collections: `blog` and `projects` (defined in `src/content.config.ts`)

### File layout

```
src/
  components/nvim/     ← all Neovim UI widgets (Vue + Astro)
    useLeader.ts       ← singleton keyboard state machine
    KeyboardController.vue
    NeoTree.vue
    BufferLine.vue
    StatusLine.vue
    WhichKey.vue
    CommandPalette.vue
    Dashboard.vue
    LineGutter.astro
  data/site.ts         ← SINGLE SOURCE OF TRUTH for pages, socials, profile
  layouts/
    EditorLayout.astro ← main Neovim chrome (BufferLine + NeoTree + StatusLine + overlays)
  pages/               ← Astro pages (index, about, blog/*, projects/*, 404)
  styles/global.css    ← Catppuccin vars + Tailwind + fonts
  content/
    blog/              ← Markdown/MDX blog posts
    projects/          ← Markdown/MDX project entries
```

### Catppuccin color tokens

All colors are CSS custom properties (e.g. `var(--ctp-blue)`).
Use Tailwind classes where possible (`bg-base`, `text-text`, `text-blue`, etc.).
Do NOT hardcode hex colors.

**Semantic roles:**
- `--ctp-base` → editor background
- `--ctp-mantle` → sidebar (NeoTree), StatusLine background
- `--ctp-crust` → BufferLine, tab strip
- `--ctp-surface0` → active item highlight, cursorline, input backgrounds
- `--ctp-text` / `--ctp-subtext1` → primary / secondary text
- `--ctp-overlay0` → line numbers, subdued hints
- `--ctp-blue` → accent: active items, links, icons, mode pill
- `--ctp-mauve` → section headings (H1), NeoTree header
- `--ctp-peach` → strong emphasis, which-key group labels
- `--ctp-green` → success indicators, Telescope prompt arrow
- `--ctp-red` → errors, 404

### Vue island conventions

- Every interactive widget uses `client:only="vue"` (no SSR)
- Import `useLeader` from `./useLeader` to read / act on keyboard state
- Don't create new global keyboard handlers unless necessary — use `useLeader` instead
- Props passed from Astro must be JSON-serializable (no class instances, no functions)

### Single source of truth

`src/data/site.ts` defines:
- `pages` — drives NeoTree, BufferLine, WhichKey, CommandPalette, Dashboard
- `socials` — drives Dashboard footer
- `profile` — drives Dashboard header and StatusLine

**Never hardcode page lists or profile info in components.** Always import from `site.ts`.

### Content collections

- Blog posts: `src/content/blog/*.{md,mdx}` — required frontmatter: `title`, `date`, `description`, `tags[]`, `draft`
- Projects: `src/content/projects/*.{md,mdx}` — required: `title`, `description`, `tags[]`; optional: `url`, `repo`, `featured`, `order`

### Keyboard shortcuts

| Keys | Action |
|------|--------|
| `Space` | Open which-key popup |
| `Space f` | Open command palette |
| `Space e` | Toggle NeoTree |
| `Space g h` | Go to dashboard |
| `Space g a` | Go to about |
| `Space g b` | Go to blog |
| `Space g p` | Go to projects |
| `Space b n` | Next buffer |
| `Space b p` | Previous buffer |
| `Space t` | Toggle Catppuccin Latte ↔ Mocha |
| `Space 1-4` | Go to buffer by index |
| `j` / `k` | Move in NeoTree (when sidebar focused) |

### Verification after changes

Run `npm run build` — this is what CI runs and it must succeed.

### PWA / Offline support

The site ships as an installable Progressive Web App.

**Files:**
- `public/manifest.json` — web app manifest (Catppuccin Latte colors, `display: standalone`)
- `public/sw.js` — lightweight service worker (no dependencies)
- `public/pwa-icon.svg` — PWA/apple-touch-icon (scalable SVG with "dh" monogram)

**Service worker caching strategy:**
| Request type | Strategy | Description |
|---|---|---|
| Navigation (HTML) | Network-first | Fresh content when online; cached fallback when offline |
| Static assets (css, js, woff2, png, svg, ico, webp) | Cache-first | Hashed by Astro, immutable; instant reloads |
| Other same-origin GET | Network-first | Falls back to cache if network unavailable |
| Cross-origin / non-GET | Bypass | No caching |

**Registration:** Inline script in `EditorLayout.astro` registers `/sw.js` on `window.load` — does not block first paint.

**Icons:** The PWA icon (`public/pwa-icon.svg`) is a hand-crafted SVG. No build-time icon generation is needed. To update the icon, edit the SVG directly.

**Testing offline:**
1. `npm run build && npm run preview`
2. Open DevTools → Application → Service Workers
3. Check "Offline" and reload — cached pages should render
