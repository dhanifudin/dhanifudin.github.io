/**
 * useLeader — global keyboard state machine (singleton)
 *
 * Shared across all client-side Vue islands. Models Neovim's leader-key flow:
 *   idle → press Space → leader active → press key → action / sub-map → dismiss
 *
 * The module-level refs act as a singleton; all components share the same state
 * within a single page load (Vite module cache).
 */
import { ref, readonly } from 'vue';

// ─── State ────────────────────────────────────────────────────────────────────
export type LeaderState = 'idle' | 'leader' | 'sub:g' | 'sub:b';

const _state       = ref<LeaderState>('idle');
const _whichKeyOpen = ref(false);
const _paletteOpen  = ref(false);
const _neoTreeOpen  = ref(typeof window === 'undefined' ? true : window.innerWidth > 768);

// ─── Page order for buffer cycling ────────────────────────────────────────────
const PAGE_ORDER = ['/', '/about', '/blog', '/projects'] as const;

// ─── Internal helpers ─────────────────────────────────────────────────────────
function go(path: string) {
  if (typeof window !== 'undefined') window.location.href = path;
}

function adjacentPage(dir: 1 | -1) {
  if (typeof window === 'undefined') return;
  const raw  = window.location.pathname;
  const path = raw.endsWith('/') && raw !== '/' ? raw.slice(0, -1) : raw;
  const idx  = PAGE_ORDER.indexOf(path as (typeof PAGE_ORDER)[number]);
  const next = PAGE_ORDER[(idx + dir + PAGE_ORDER.length) % PAGE_ORDER.length];
  go(next);
}

// ─── Exported actions ─────────────────────────────────────────────────────────
export function dismiss() {
  _state.value       = 'idle';
  _whichKeyOpen.value = false;
}

export function openLeader() {
  _state.value       = 'leader';
  _whichKeyOpen.value = true;
}

export function openPalette() {
  dismiss();
  _paletteOpen.value = true;
}

export function closePalette() {
  _paletteOpen.value = false;
}

export function toggleTree() {
  _neoTreeOpen.value = !_neoTreeOpen.value;
}

export function toggleTheme() {
  if (typeof document === 'undefined') return;
  const current = document.documentElement.getAttribute('data-theme') ?? 'latte';
  const next    = current === 'mocha' ? 'latte' : 'mocha';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('flavor', next); } catch { /* noop */ }
}

// ─── State machine ────────────────────────────────────────────────────────────
export function handleLeaderKey(key: string) {
  switch (_state.value) {
    /* ── First keypress after <leader> ── */
    case 'leader':
      // Hide the top-level grid; sub-map groups will show their own children
      _whichKeyOpen.value = false;
      switch (key) {
        case 'Escape': dismiss(); break;
        case 'f':  openPalette(); break;
        case 'e':  dismiss(); toggleTree(); break;
        case 'g':  _state.value = 'sub:g'; _whichKeyOpen.value = true; break;
        case 'b':  _state.value = 'sub:b'; _whichKeyOpen.value = true; break;
        case 't':  dismiss(); toggleTheme(); break;
        case '1':  dismiss(); go('/'); break;
        case '2':  dismiss(); go('/about'); break;
        case '3':  dismiss(); go('/blog'); break;
        case '4':  dismiss(); go('/projects'); break;
        default:   dismiss(); break;
      }
      break;

    /* ── Sub-map: g (goto page) ── */
    case 'sub:g':
      switch (key) {
        case 'h':      dismiss(); go('/'); break;
        case 'a':      dismiss(); go('/about'); break;
        case 'b':      dismiss(); go('/blog'); break;
        case 'p':      dismiss(); go('/projects'); break;
        case 'Escape': dismiss(); break;
        default:       dismiss(); break;
      }
      break;

    /* ── Sub-map: b (buffers) ── */
    case 'sub:b':
      switch (key) {
        case 'n':      dismiss(); adjacentPage(1); break;
        case 'p':      dismiss(); adjacentPage(-1); break;
        case 'Escape': dismiss(); break;
        default:       dismiss(); break;
      }
      break;

    default:
      dismiss();
      break;
  }
}

// ─── Composable ───────────────────────────────────────────────────────────────
export function useLeader() {
  return {
    state:        readonly(_state),
    whichKeyOpen: readonly(_whichKeyOpen),
    paletteOpen:  readonly(_paletteOpen),
    neoTreeOpen:  readonly(_neoTreeOpen),
    openLeader,
    dismiss,
    openPalette,
    closePalette,
    toggleTree,
    toggleTheme,
    handleLeaderKey,
  };
}
