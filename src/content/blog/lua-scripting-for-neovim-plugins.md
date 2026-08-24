---
title: "Lua scripting for Neovim plugins — from init.lua to your first plugin"
date: 2026-08-24
description: "Stop editing other people's configs and start writing your own. Learn the Lua runtime primitives every plugin author needs, build a timestamp module from scratch, expose it as a user command and keymap, wire an autocommand, package it as a lazy.nvim plugin, and test it with plenary."
tags: ["neovim", "lua", "lazyvim", "plugin-development", "developer-environment", "tutorial"]
series:
  id: cli-first-development
  name: "CLI-first development"
  order: 2
  description: "A keyboard-first workflow, from building a Neovim editor you love to living in the terminal."
draft: false
---

## Prerequisites

This post picks up where [Neovim from scratch to LazyVim](/blog/neovim-from-scratch-to-lazyvim)
left off. If you haven't read it, do that first — it walks through installing Neovim, the
`~/.config/nvim` layout, and the LazyVim distribution this tutorial assumes. Everything below
works on a bare Neovim too, but the `lazy.nvim` section only makes sense once you have a plugin
manager.

You should be comfortable editing `init.lua` and re-sourcing it. If the phrase
`require("config.options")` means nothing to you yet, go back one post.

## Why Lua (and not Vimscript)

Neovim has two scripting languages: the old **Vimscript**, inherited from Vim, and **Lua**,
adopted as a first-class citizen starting in Neovim 0.5. For writing plugins, Lua wins on almost
every axis:

- **It's already there.** Lua is compiled into the Neovim binary as the runtime via
  [LuaJIT](https://luajit.org). No interpreter to install, no version to manage.
- **It's faster.** LuaJIT is a just-in-time compiler, often orders of magnitude faster than
  Vimscript's interpreter for the tight loops you find in a plugin's hot path.
- **First-class tables.** Lua's single data structure — the table — maps perfectly onto config
  blobs, `opts` tables, and plugin specs. No `dict` vs `list` vs `object` distinctions.
- **Full `vim.api` access.** Every internal Neovim function is exposed through the `vim.api`
  namespace, and Lua can call into *and* be called from Vimscript freely. You lose nothing by
  picking Lua.

Vimscript still works and still matters (you'll call it constantly through `vim.cmd`), but you
should write everything new in Lua. The ecosystem has already made that choice: LazyVim, lazy.nvim,
and virtually every plugin published since 2021 is Lua.

## Lua runtime basics every plugin author needs

Six namespaces carry 90% of what you'll do. Learn these and you can read almost any plugin's
source.

### `vim.api`

The official, stable API for talking to Neovim. Anything a plugin does — create a buffer, set a
keymap, register an autocmd — goes through here. The naming is consistent:
`vim.api.nvim_<domain>_<verb>`.

```lua
vim.api.nvim_set_current_buf(1)          -- switch to buffer 1
vim.api.nvim_echo({ { "hi", "Normal" } }, false, {})  -- print to the message area
```

### `vim.fn`

A bridge to every Vimscript function. When the `vim.api` equivalent doesn't exist (or you're
translating an old snippet), reach for `vim.fn`. Note the `nvim_` prefix is omitted here:

```lua
local home = vim.fn.expand("~")          -- ~ expands to $HOME
local found = vim.fn.executable("rg")    -- 1 if ripgrep is on PATH
```

### `vim.opt`

A table interface for editor options. `vim.opt.number = true` is the Lua spelling of
`:set number`. Values are set with plain assignment, and table options take a list:

```lua
vim.opt.number = true
vim.opt.tabstop = 4
vim.opt.clipboard = "unnamedplus"
```

### `vim.keymap.set`

The one true way to map keys. It takes the mode, the key sequence, the action (a string or a
Lua function), and an options table:

```lua
vim.keymap.set("n", "<leader>q", "<cmd>quit<cr>", { desc = "Quit" })
vim.keymap.set("n", "<leader>x", function() print("mapped") end, { desc = "Say hi" })
```

Always set `desc`. It feeds which-key and future-you.

### `vim.cmd`

Runs a Vimscript command as a string. Useful for commands that don't have a Lua equivalent yet:

```lua
vim.cmd("colorscheme catppuccin")
vim.cmd("normal! gg=G")   -- re-indent the whole buffer
```

### `require()`

Lua's module loader, repurposed by Neovim to load files from your `lua/` directory. A module is
just a Lua file that returns a table. `require("config.options")` looks for
`lua/config/options.lua` (or `.lua/config/options/init.lua`) and caches the returned table, so a
second `require` of the same path returns the same object instantly.

```lua
local opts = require("config.options")   -- loads lua/config/options.lua
```

## How Neovim finds your config

Everything starts at `init.lua` in your config directory (`~/.config/nvim` on Linux/macOS,
`~/AppData/Local/nvim` on Windows). Neovim runs it once at startup, before loading plugins.

From there, `require()` searches the `lua/` directory. The module name is the file path with
slashes as dots and no extension:

```
~/.config/nvim/
├── init.lua              ← entrypoint, run at startup
└── lua/
    ├── config/
    │   ├── options.lua   ← require("config.options")
    │   └── keymaps.lua   ← require("config.keymaps")
    └── timestamp.lua     ← require("timestamp")
```

Two conventions fall out of this:

- **`init.lua` is a bootstrapper, not a dumping ground.** Keep it a handful of `require()` calls.
  The real logic lives in `lua/`.
- **A module can be a file or a directory.** `lua/timestamp.lua` and
  `lua/timestamp/init.lua` are both loaded by `require("timestamp")`. Single-file modules are
  fine for small helpers; directories are how real plugins organize submodules.

This is the whole mental model. `init.lua` seeds the process, `require()` pulls in everything
else, and each module does one job.

## Your first custom module

Let's build something real: a **timestamp inserter** that drops the current date and time at the
cursor. Small enough to finish in one sitting, structured enough to teach you the pattern.

Create `lua/timestamp.lua`:

```lua
-- lua/timestamp.lua
local M = {}

function M.format()
  return os.date("%Y-%m-%d %H:%M:%S")
end

function M.insert()
  vim.api.nvim_put({ M.format() }, "c", true, true)
end

return M
```

Three things are happening:

- `local M = {}` creates the table the module will return. Functions hang off it.
- `M.format()` builds a timestamp string using Lua's built-in `os.date`.
- `M.insert()` writes that string at the cursor. `vim.api.nvim_put` places text relative to the
  cursor line: the `"c"` is cursor-relative mode and the two `true`s mean *place after the
  cursor* and *advance the cursor*.
- `return M` is non-negotiable — without it, `require()` gets `nil`.

Now load it from `init.lua`. You don't have to; this is just to prove the module resolves:

```lua
-- init.lua
require("config.options")
require("config.keymaps")
require("config.lazy")

-- try it: run :lua require("timestamp").insert()
```

Open Neovim and run:

```vim
:lua require("timestamp").insert()
```

A timestamp appears at your cursor. You just wrote and loaded your first Lua module.

> **Tip:** if you get `module 'timestamp' not found`, check two things — the file lives under
> `lua/` (not next to `init.lua`), and the filename minus `.lua` matches the `require` string.

## Exposing a user command and keymap

Typing `:lua require("timestamp").insert()` every time is miserable. Wrap the module in a
command, then bind the command to a key.

Commands come from `vim.api.nvim_create_user_command`. It takes a name (must start with an
uppercase letter), the function to run, and an options table:

```lua
-- lua/timestamp.lua (append, or keep in a separate file)
local M = {}

function M.format()
  return os.date("%Y-%m-%d %H:%M:%S")
end

function M.insert()
  vim.api.nvim_put({ M.format() }, "c", true, true)
end

vim.api.nvim_create_user_command("InsertTimestamp", M.insert, {
  desc = "Insert the current timestamp at the cursor",
})

return M
```

Restart Neovim (or `:luafile %` on the open file) and run:

```vim
:InsertTimestamp
```

A one-word command is better than a Lua one-liner, but it's still a command. The natural home
for a quick action like this is a keymap, bound under your `<leader>`. In `lua/config/keymaps.lua`
(or a new `lua/timestamp.lua` section), add:

```lua
-- Bind the command to <leader>ut
vim.keymap.set("n", "<leader>ut", "<cmd>InsertTimestamp<cr>", {
  desc = "Insert timestamp",
})
```

The `<cmd>` form runs the command in command-line mode without leaving normal mode — always
prefer it over `:`-style mappings for this. Press Space, then `u`, then `t` (LazyVim maps
`<leader>` to Space). which-key shows your new entry, `desc` and all.

Notice the layering: a **module function** (`M.insert`) → a **user command** (`:InsertTimestamp`)
→ a **keymap** (`<leader>ut`). Real plugins build the same stack, so get comfortable with each
rung.

## Autocommands in Lua

So far everything is pull-driven — you ask for it and it happens. Autocommands are the push side:
they fire when an *event* happens, like a file being saved or a buffer opening.

The old way is a Vimscript string. Skip it:

```vim
" don't do this
autocmd BufWritePre *.md :call SomeFunction()
```

The Lua way uses `vim.api.nvim_create_autocmd` and — importantly — an **augroup** to keep your
autocmds named and clearable. If you skip the group, re-sourcing your config stacks duplicate
autocmds every time.

```lua
-- lua/timestamp.lua (append)
local augroup = vim.api.nvim_create_augroup("timestamp", { clear = true })

vim.api.nvim_create_autocmd("BufWritePre", {
  group = augroup,
  pattern = "*.md",
  callback = function()
    -- e.g. keep a "last updated" line in sync before saving
    vim.notify("Saving markdown at " .. M.format(), vim.log.levels.INFO)
  end,
})
```

Breaking it down:

- `nvim_create_augroup("timestamp", { clear = true })` creates (or clears) a group named
  `timestamp`. `clear = true` wipes any autocmds already in that group before adding more, so
  re-sourcing never duplicates them.
- `pattern` is a glob matching the filename — `*.md` for Markdown, `*` for everything.
- `callback` is your Lua function, called with an event table argument.

This is a logging example; a more useful pattern replaces the placeholder text in a template, or
formats code before a save. The shape — augroup + event + pattern + callback — is the same for
every event. Run `:h autocmd-events` for the full list of what you can listen to.

## Loading a local plugin with lazy.nvim

A config-side module is fine for *your* tweaks, but a plugin is something you'd want to reuse and
share. lazy.nvim — the plugin manager under LazyVim — can load a plugin straight from a local
directory, no GitHub required. This is the fastest way to develop a plugin before you publish it.

Restructure your module into a standalone plugin directory with its own `lua/` tree:

```
~/projects/nvim-timestamp/
├── lua/
│   └── timestamp/
│       └── init.lua       ← the module (renamed from lua/timestamp.lua)
└── README.md
```

Move `timestamp.lua` to `lua/timestamp/init.lua` (the module name `timestamp` still resolves —
a directory with `init.lua` works identically). Then point lazy.nvim at it:

```lua
-- lua/plugins/timestamp.lua
return {
  {
    dir = "~/projects/nvim-timestamp",
    name = "timestamp",
    opts = {},
  },
}
```

`dir` is the local path; `name` gives it a friendly label in `:Lazy`. `opts = {}` signals that
your plugin exposes a setup function (see below), which lazy.nvim calls automatically. Open
Neovim, run `:Lazy`, and your local plugin shows up alongside the remote ones.

To make the module configurable, accept an options table in a `setup` function:

```lua
-- ~/projects/nvim-timestamp/lua/timestamp/init.lua
local M = {}

M.config = {
  format = "%Y-%m-%d %H:%M:%S",
}

function M.setup(opts)
  M.config = vim.tbl_deep_extend("force", M.config, opts or {})
end

function M.format()
  return os.date(M.config.format)
end

function M.insert()
  vim.api.nvim_put({ M.format() }, "c", true, true)
end

return M
```

Now lazy.nvim's `opts` table flows straight into `setup`:

```lua
-- lua/plugins/timestamp.lua
return {
  {
    dir = "~/projects/nvim-timestamp",
    name = "timestamp",
    opts = {
      format = "%H:%M", -- compact time-only stamps
    },
  },
}
```

This `setup(opts)` convention is universal — it's how every plugin you install accepts config.
Write your own this way and your plugin will feel familiar to anyone who picks it up.

## Testing with plenary.nvim

A plugin you can't verify is a plugin you can't trust to upgrade. [plenary.nvim](https://github.com/nvim-lua/plenary.nvim)
is the standard test harness: it bundles the **busted** test framework and a headless runner that
drives Neovim.

Because `M.format()` is pure (no editor state), it's trivially testable. Add a spec:

```lua
-- tests/timestamp_spec.lua
local timestamp = require("timestamp")

describe("timestamp", function()
  it("formats a timestamp string", function()
    assert.is_string(timestamp.format())
    assert.matches("%d%d%d%d%-%d%d%-%d%d", timestamp.format())
  end)
end)
```

The spec needs Neovim to find both plenary and your module. A minimal init file sets the runtime
path:

```lua
-- tests/minimal_init.lua
vim.cmd([[set rtp+=~/.local/share/nvim/lazy/plenary.nvim]])
vim.cmd([[set rtp+=~/projects/nvim-timestamp]])
```

Then run the suite headlessly:

```bash
nvim --headless -u tests/minimal_init.lua \
  -c "PlenaryBustedDirectory tests { minimal_init = 'tests/minimal_init.lua' }"
```

The `describe`/`it`/`assert` API comes from busted; `assert.matches` checks the timestamp against
a pattern (`YYYY-MM-DD`). Keep your pure logic — formatting, parsing, table shaping — in
functions like `format()`, and push the `vim.api` side effects into thin wrappers. That split is
what makes the plugin testable without mocking the editor.

## Next steps

You've gone from a blank `init.lua` to a structured, testable local plugin. Here's where to take
it.

- **Publish it.** Push `~/projects/nvim-timestamp` to GitHub and swap `dir = ...` for
  `{ "you/nvim-timestamp", opts = {} }`. LazyVim-style `setup(opts)` conventions, a `README`, and
  a passing test suite are what separate a real plugin from a gist.
- **Contribute to LazyVim extras.** Browse `:LazyExtras` and read the source of one you use. The
  extras are just Lua specs — the same shape you wrote above — and a well-scoped fix makes a great
  first contribution.
- **Keep the series going.** The next logical stops are *terminal workflows: tmux, zsh, fzf* and
  *fuzzy-finding everything with fzf/telescope*, both of which build directly on the editor and
  scripting skills you have now.

The pattern to remember isn't the timestamp — it's the shape: **module function → command →
keymap**, wrapped in an augroup, packaged as a `setup(opts)` plugin, and pinned down by a test.
Internalize that and you'll never look at someone else's Neovim config the same way again.

- [Neovim Lua guide](https://neovim.io/doc/user/lua.html) — the canonical `:h lua` reference.
- [lazy.nvim docs](https://lazy.folke.io) — plugin specs, `dir`, and local development.
- [plenary.nvim](https://github.com/nvim-lua/plenary.nvim) — the test harness used above.
- [awesome-neovim](https://github.com/rockerBOO/awesome-neovim) — a thousand real-world Lua
  plugins to read and learn from.
