---
title: "Neovim from scratch to LazyVim — a practical setup guide"
date: 2026-08-17
description: "Go from a bare Neovim install to a full LazyVim-based editor: install the binary, understand the config layout, bootstrap LazyVim, customize the UI with Catppuccin, wire up LSP and tooling, and keep the keymaps that actually stick."
tags: ["neovim", "lazyvim", "catppuccin", "developer-environment", "lua", "lsp", "tutorial"]
series:
  id: cli-first-development
  name: "CLI-first development"
  order: 1
  description: "A keyboard-first workflow, from building a Neovim editor you love to living in the terminal."
draft: false
---

## Why I switched to Neovim

I was a VS Code user for years. It worked, mostly. But there was always a faint
friction — a mouse click here, a context-menu dive there, a settings JSON that never quite
felt like _mine_. The deeper I got into cloud and backend work, the more of my day was spent
in a terminal: `kubectl`, `docker`, `git`, `go test`. Every time I tabbed out to a GUI editor,
I lost the thread.

Neovim is a bet on **keyboard-first everything**. No toolbar to reach for, no drag-and-drop,
no panel that pops in from nowhere. Every action is a keypress, every setting is a plain-text
file you can read, diff, and version in git. That last part is the real unlock: my editor is a
repo. I can clone my entire setup onto a fresh machine and be productive in minutes.

The cost is upfront. Out of the box, Neovim is a blank slate — you have to _decide_ how it
behaves. That's exactly what this guide is for. We'll go from a raw install to a
[LazyVim](https://www.lazyvim.org)-based setup with Catppuccin, a full LSP stack, and the
keymaps that stuck with me. This is the same editor behind [this site's UI](/blog/hello-neovim) —
the Neo-tree sidebar, which-key popup, Telescope palette, and statusline are all nods to the
workflow I use every day.

## Installing Neovim

Two channels matter: **stable** and **nightly**.

- **Stable** is the tagged release. It's what you want on a server or a machine you can't
  afford to babysit.
- **Nightly** is built from `master`. It lands new features first — and occasionally breaks
  them. Several popular plugins (including some LazyVim extras) expect a recent version.

My advice: start with stable. Upgrade to nightly only when a plugin error message or a
`:checkhealth` warning tells you a feature is missing. Here's how to install each.

**macOS** (via Homebrew):

```bash
brew install neovim            # stable
brew install --HEAD neovim     # nightly
```

**Linux** — don't rely on the distro package, which is often months old. Download the
official AppImage or tarball instead:

```bash
# AppImage (Ubuntu/Debian-friendly)
curl -LO https://github.com/neovim/neovim/releases/latest/download/nvim-linux-x86_64.appimage
chmod u+x nvim-linux-x86_64.appimage
sudo mv nvim-linux-x86_64.appimage /usr/local/bin/nvim
```

**Windows**:

```bash
winget install Neovim.Neovim
```

**Verify** the install and your runtime health:

```bash
nvim --version
```

Then open Neovim and run:

```vim
:checkhealth
```

`:checkhealth` is your best friend during setup. It reports on clipboard support, Python/Node
providers, and — once you add plugins — LSP and treesitter status. When something breaks, this
is the first place to look.

## Understanding the config layout

Neovim looks for configuration in one of a few standard paths depending on platform
(`~/.config/nvim` on Linux/macOS, `~/AppData/Local/nvim` on Windows). Inside, a conventional
layout has grown out of the Lua migration:

```
~/.config/nvim/
├── init.lua            ← entrypoint, loaded first
├── lua/
│   ├── config/
│   │   ├── options.lua ← vim.opt.* settings
│   │   ├── keymaps.lua ← vim.keymap.set bindings
│   │   └── lazy.lua    ← lazy.nvim bootstrap
│   └── plugins/        ← one file per plugin (or per concern)
│       ├── colorscheme.lua
│       ├── lsp.lua
│       └── ...
└── ...
```

`init.lua` is the entrypoint. It usually stays tiny — just requiring the files that do the real
work:

```lua
-- init.lua
require("config.options")
require("config.keymaps")
require("config.lazy")
```

Why split it up? Because a single 2,000-line `init.lua` is impossible to maintain. When
something breaks you want to know _which file_ to open, not which line to hunt for. The
`lua/config/` directory holds core settings; `lua/plugins/` holds plugin specs, one per concern.

Two other conventions matter before we go further:

- **`vim.opt`** vs **`vim.g`**. `vim.opt` is for editor options that have a `:set` equivalent
  (`number`, `tabstop`, `clipboard`); `vim.g` is for global variables, often plugin flags.
- **`leader`** is a prefix key you reserve for your own bindings. It's `\` by default, which is
  useless; almost everyone remaps it to Space.

## From manual config to a distribution

You _can_ hand-roll everything. Start with `vim.opt` settings, add `lazy.nvim` as your plugin
manager, and declare each plugin with `use` calls. It's educational, and I recommend everyone do
it once. But maintaining a fully featured setup is a part-time job:

- Treesitter needs parsers installed and managed.
- LSP needs `mason`, `nvim-lspconfig`, `cmp`, and a web of glue.
- Every upgrade risks a breaking change in some plugin you configured by hand two years ago.

That's the problem **LazyVim** solves. LazyVim is a _distribution_: a pre-assembled, opinionated
Neovim configuration built on top of `lazy.nvim`. It ships sane defaults for everything —
completion, LSP, treesitter, telescope, which-key, bufferline, statusline — so you spend your
time _tuning_ rather than _building_.

The trade-off is less visibility into every moving part. But LazyVim is structured so you can
override anything without forking the whole thing. You add plugins and tweak options from
_your_ config; the distribution stays upstream and upgradeable. That's the sweet spot.

## Installing LazyVim

LazyVim's install is a single git clone into your config directory. But first, back up whatever
you already have:

```bash
# Required dependencies: a recent git, a Nerd Font (for icons), and ripgrep
# Check ripgrep — telescope uses it for live grep:
which rg || echo "install ripgrep (brew install ripgrep / apt install ripgrep)"

# Back up an existing config
mv ~/.config/nvim ~/.config/nvim.bak
# Optional: also clear old state
mv ~/.local/share/nvim ~/.local/share/nvim.bak
mv ~/.local/state/nvim ~/.local/state/nvim.bak
mv ~/.cache/nvim ~/.cache/nvim.bak
```

Then clone the starter:

```bash
git clone https://github.com/LazyVim/starter ~/.config/nvim
rm -rf ~/.config/nvim/.git
```

Open Neovim and let it do its thing:

```bash
nvim
```

On first launch, `lazy.nvim` bootstraps itself, downloads every plugin, installs treesitter
parsers, and (if you accept the prompt) installs your LSP servers through Mason. Give it a minute
or two. When it finishes, run:

```vim
:Lazy
```

You should see a dashboard listing your plugins with no errors. If you see red, run
`:Lazy` → `I` (install) and `:checkhealth` before going further.

> **Heads-up:** the starter clones a git repo, so we delete `.git` to make it _your_ config.
> Better yet, follow the **dotfiles** approach in "Next steps" below so your config is versioned
> under your own remote from day one.

## Core LazyVim concepts

Before customizing, understand the vocabulary. LazyVim is a thin layer over `lazy.nvim`, so
these concepts transfer directly.

### Plugin specs

A plugin is declared as a Lua table. The minimal form:

```lua
{ "folke/which-key.nvim" }
```

But real specs carry **`opts`**, **`keys`**, and **`dependencies`**:

```lua
{
  "neovim/nvim-lspconfig",
  opts = {
    servers = { "gopls", "tsserver" },
  },
  keys = {
    { "gd", vim.lsp.buf.definition, desc = "Goto definition" },
  },
}
```

- **`opts`** is a table merged into the plugin's default settings (LazyVim uses
  `opts = {}` for most of its plugins). This is how you customize without copying a whole
  config blob.
- **`keys`** declares keymaps that also trigger lazy-loading — the plugin isn't loaded until
  you press one of its keys.
- **`dependencies`** list plugins that must load first.

### `LazyExtras`

LazyVim keeps optional functionality in **extras** — opt-in bundles you enable with one line.
Language support, additional tools, and quality-of-life packs live here. Enable an extra by
creating `lua/plugins/extras.lua` and returning a list of specs:

```lua
-- lua/plugins/extras.lua
return {
  { import = "lazyvim.plugins.extras.lang.typescript" },
  { import = "lazyvim.plugins.extras.lang.go" },
  { import = "lazyvim.plugins.extras.lang.json" },
  { import = "lazyvim.plugins.extras.ui.mini-animate" },
}
```

Browse the full catalog with `:LazyExtras` — it lists every extra with a toggle and a
description. This is where most of your "setup" actually happens: enabling the Go or TypeScript
extra wires up treesitter, LSP, formatters, and linters for that language in one shot.

### `leader` and `localleader`

LazyVim maps `<leader>` to **Space** and `<localleader>` to **`,`** (comma). Leader is for
global actions (find file, toggle things); localleader is for buffer- or language-specific
actions. Every LazyVim keymap is discoverable: press **Space** and `which-key` pops up with a
menu of what comes next.

You can rebind them in `lua/config/keymaps.lua`:

```lua
vim.g.mapleader = " "
vim.g.maplocalleader = ","
```

## Customizing the UI

This is where the editor becomes _yours_. LazyVim's default theme is
[tokyonight](https://github.com/folke/tokyonight.nvim), but the whole reason I'm here is
[Catppuccin](https://github.com/catppuccin/nvim). (I wrote about why
[here](/blog/catppuccin-everywhere).)

### Catppuccin colorscheme

LazyVim ships a `colorscheme` extra. Add a file:

```lua
-- lua/plugins/colorscheme.lua
return {
  {
    "catppuccin/nvim",
    name = "catppuccin",
    priority = 1000, -- load early
    opts = {
      flavor = "mocha", -- latte, frappe, macchiato, or mocha
      integrations = {
        bufferline = true,
        lualine = true,
        which_key = true,
        telescope = true,
        neo_tree = true,
        gitsigns = true,
      },
    },
    init = function()
      vim.cmd.colorscheme("catppuccin")
    end,
  },
}
```

`priority = 1000` ensures it loads before other UI plugins so nothing flashes the wrong theme.
The `integrations` table tells Catppuccin to theme those plugins consistently — this is what
makes the whole UI feel like one palette instead of a patchwork.

Toggle between light and dark on the fly (I use this constantly — the site mirrors it with
`Space t`):

```lua
-- Toggle Catppuccin Mocha <-> Latte
vim.keymap.set("n", "<leader>ct", function()
  local cur = require("catppuccin").options.flavor
  vim.g.catppuccin_flavor = cur == "mocha" and "latte" or "mocha"
  vim.cmd("Catppuccin " .. vim.g.catppuccin_flavor)
end, { desc = "Toggle Catppuccin flavor" })
```

### Bufferline and lualine

LazyVim's bufferline and statusline come pre-configured. You mostly tweak `opts`:

```lua
-- lua/plugins/ui.lua
return {
  {
    "akinsho/bufferline.nvim",
    opts = {
      options = {
        separator_style = "slant",
        show_buffer_close_icons = false,
        diagnostics = "nvim_lsp",
      },
    },
  },
  {
    "nvim-lualine/lualine.nvim",
    opts = {
      options = {
        component_separators = { left = "", right = "" },
        section_separators = { left = "", right = "" },
      },
    },
  },
}
```

The statusline on this site (mode pill → branch → filename → filetype → clock) is a direct
tribute to my lualine setup.

### Font setup

All those icons — filetype glyphs, chevrons, branch symbols — come from a **Nerd Font**, which
patches icon glyphs into a regular font. [Fira Code Nerd Font](https://www.nerdfonts.com/font-downloads)
is my choice: ligatures for `=>`, `!=`, and `->`, plus the icon set. Install it, then set your
terminal and your GUI font to `FiraCode Nerd Font`. Without a Nerd Font every icon renders as a
broken box. (This site uses [Fira Code](/blog/hello-neovim) for the same reason.)

## LSP and tooling

This is where Neovim becomes a real IDE. The stack has four layers, and LazyVim wires them
together for you:

| Layer | Tool | Job |
|-------|------|-----|
| Server management | `mason.nvim` | Install/update language servers, formatters, linters |
| LSP client | `nvim-lspconfig` | Configure and connect Neovim to servers |
| Completion | `nvim-cmp` | Autocomplete, snippets, source integration |
| Syntax | `tree-sitter` | Incremental parsing for highlighting, folding, refactors |

### Mason — installing language servers

Open Mason with:

```vim
:Mason
```

Search, install, and pin versions of servers (`gopls`, `tsserver`, `pyright`, `lua_ls`),
formatters (`prettier`, `gofmt`, `stylua`), and linters (`eslint`, `golangci-lint`) from one UI.
Everything installs into `~/.local/share/nvim/mason`, isolated from your system.

### Configuring LSP servers

LazyVim's `nvim-lspconfig` extra sets up servers from a simple list:

```lua
-- lua/plugins/lsp.lua
return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        gopls = {
          settings = {
            gopls = { hints = { assignVariableTypes = true } },
          },
        },
        tsserver = {},
        lua_ls = {
          settings = {
            Lua = {
              workspace = { checkThirdParty = false },
              completion = { callSnippet = "Replace" },
            },
          },
        },
      },
    },
  },
}
```

The language extras (`lang.go`, `lang.typescript`) configure most of this automatically; you
only need this file for per-server overrides.

### Formatters and linters

LazyVim uses `conform.nvim` for formatting and `nvim-lint` for linting. Format on save is on by
default; here's how to wire a specific formatter for a filetype:

```lua
-- lua/plugins/format.lua
return {
  {
    "stevearc/conform.nvim",
    opts = {
      formatters_by_ft = {
        lua = { "stylua" },
        go = { "gofmt", "goimports" },
        javascript = { { "prettierd", "prettier" } },
        markdown = { "prettierd", "prettier" },
      },
    },
  },
}
```

### Tree-sitter

Tree-sitter parsers are installed automatically by the language extras. Run
`:checkhealth treesitter` to confirm every parser you need is installed. If one's missing:

```vim
:TSInstall go
```

## Keymaps that stuck

I keep my personal bindings in one file so I can skim it once a week and drop what I'm not
using. The ones below earned a permanent place.

```lua
-- lua/config/keymaps.lua
local map = vim.keymap.set

-- Files
map("n", "<leader>ff", "<cmd>Telescope find_files<cr>", { desc = "Find file" })
map("n", "<leader>fg", "<cmd>Telescope live_grep<cr>", { desc = "Live grep" })
map("n", "<leader>fr", "<cmd>Telescope oldfiles<cr>", { desc = "Recent files" })

-- Buffers
map("n", "<leader>bn", "<cmd>bnext<cr>", { desc = "Next buffer" })
map("n", "<leader>bp", "<cmd>bprevious<cr>", { desc = "Prev buffer" })
map("n", "<leader>bd", "<cmd>bdelete<cr>", { desc = "Delete buffer" })
map("n", "<S-h>", "<cmd>bprevious<cr>", { desc = "Prev buffer" })
map("n", "<S-l>", "<cmd>bnext<cr>", { desc = "Next buffer" })

-- Git
map("n", "<leader>gg", "<cmd>lua Snacks.lazygit()<cr>", { desc = "LazyGit" })
map("n", "<leader>gb", "<cmd>lua Snacks.git.blame_line()<cr>", { desc = "Blame line" })

-- Window movement
map("n", "<C-h>", "<C-w>h", { desc = "Go to left window" })
map("n", "<C-l>", "<C-w>l", { desc = "Go to right window" })
map("n", "<C-j>", "<C-w>j", { desc = "Go to lower window" })
map("n", "<C-k>", "<C-w>k", { desc = "Go to upper window" })
```

A few principles behind these:

- **Mnemonics beat speed.** `ff` = find file, `fg` = live grep. You'll remember them because
  they mean something, not because you drilled them.
- **One prefix, one domain.** Everything global lives under `<leader>`; buffer-hopping gets
  `Shift+h`/`Shift+l` because it's the action I do most.
- **`desc` is non-negotiable.** Without a `desc`, the keymap doesn't show up in which-key, and
  an undocumented keymap is a keymap you'll forget exists.

## Common pitfalls and fixes

**1. "Not an editor command" or a plugin that won't load.**
Your plugin manager didn't pick up a new file. Run `:Lazy` and press `S` (sync), or simply
restart Neovim. If a keymap doesn't exist, check the plugin actually loaded with `:Lazy` → filter.

**2. Icons are broken boxes.**
You're not using a Nerd Font. Install one and set it as the terminal/GUI font (see "Font setup").

**3. `:checkhealth` complains about missing providers (Python/Node).**
Some plugins need `pynvim` or a Node runtime. On macOS/Linux: `pip3 install pynvim` and ensure
`node` is on your PATH. Re-run `:checkhealth` to confirm the provider turns green.

**4. LSP isn't starting — "Client X quit with exit code" or no diagnostics.**
The server isn't installed or isn't on PATH. `:Mason` → install the server, then `:LspInfo` to
confirm it attached to the buffer. Restart with `:LspRestart`.

**5. Slow startup after adding many plugins.**
Run `:Lazy profile` to see what's loading when. Convert plugins you use rarely to lazy-load
with `cmd`, `keys`, or `event` so they only load on demand. A healthy LazyVim startup should be
well under 100 ms.

**6. A plugin conflict after an update.**
Pin the offending plugin's commit with `commit = "..."` in its spec, or roll back with `:Lazy`
→ `restore`. Read the plugin's changelog before jumping versions across a major release.

The general rule: **`:` commands first, then `:checkhealth`, then `:Lazy`.** Nine times out of
ten one of those three tells you exactly what's wrong.

## Next steps

Your editor is now your own. Here's where to take it.

### Put it in a dotfiles repo

This is the single highest-leverage move. Move your config to a git repo and symlink it into
place so every machine gets the same setup:

```bash
mkdir -p ~/dotfiles && mv ~/.config/nvim ~/dotfiles/nvim
ln -s ~/dotfiles/nvim ~/.config/nvim
cd ~/dotfiles && git init && git add nvim
git commit -m "feat: LazyVim + Catppuccin setup"
git remote add origin git@github.com:dhanifudin/dotfiles.git
git push -u origin main
```

My own config lives at [github.com/dhanifudin/nvim](https://github.com/dhanifudin/nvim) — it's
the source of truth for the editor described here, and it's listed as a [project](/projects) on
this site. Steal freely.

### Add tmux to the picture

Neovim shines inside a terminal multiplexer. tmux gives you persistent sessions, split panes
that survive SSH disconnects, and a single window that holds your editor, your test runner, and
your `kubectl` watch. Pair it with a Catppuccin tmux theme and the same Nerd Font for a seamless
look. This is the natural next entry in the CLI-first series.

### Keep reading

- [LazyVim docs](https://www.lazyvim.org) — the reference for every option and extra.
- [lazy.nvim docs](https://lazy.folke.io) — for deeper plugin-manager mechanics.
- [kickstart.nvim](https://github.com/nvim-lua/kickstart.nvim) — if you want to see a hand-rolled
  alternative and understand what LazyVim is abstracting away.
- This site's [hello-neovim](/blog/hello-neovim) and [catppuccin-everywhere](/blog/catppuccin-everywhere)
  posts, for the story behind the editor-shaped UI you're reading right now.

The endgame isn't a perfect config — it's a config you stop thinking about. Install, customize
until it's comfortable, then commit it and get back to building things.
