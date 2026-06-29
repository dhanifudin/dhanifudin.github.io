// ─── Single source of truth ───────────────────────────────────────────────────
// Drives: NeoTree · BufferLine · WhichKey · CommandPalette · Dashboard

export const profile = {
  name: 'Dian Hanifudin Subhi',
  handle: 'dhanifudin',
  role: 'Lecturer · Cloud Engineer',
  tagline: 'Building cloud infrastructure, scalable backends & teaching future engineers. Open for collaboration.',
  location: 'Malang, Indonesia',
} as const;

export interface PageDef {
  /** which-key trigger key (after <leader>g) */
  key: string;
  /** full leader sequence displayed in which-key */
  leader: string;
  /** display name */
  label: string;
  /** URL path */
  path: string;
  /** filetype icon character (Nerd Font PUA or Unicode fallback) */
  icon: string;
  /** filetype label shown in statusline */
  ft: string;
  /** buffer index (1-based, maps to <leader>N) */
  bufIdx: number;
}

export const pages: PageDef[] = [
  { key: 'h', leader: '<leader>gh', label: 'dashboard',  path: '/',          icon: '⌂',  ft: 'astro',     bufIdx: 1 },
  { key: 'a', leader: '<leader>ga', label: 'about',      path: '/about',     icon: '✎',  ft: 'markdown',  bufIdx: 2 },
  { key: 'b', leader: '<leader>gb', label: 'blog',       path: '/blog',      icon: '▤',  ft: 'directory', bufIdx: 3 },
  { key: 'p', leader: '<leader>gp', label: 'projects',   path: '/projects',  icon: '▣',  ft: 'directory', bufIdx: 4 },
];

export interface Social {
  label: string;
  url: string;
  /** unicode/emoji glyph */
  icon: string;
}

export const socials: Social[] = [
  { label: 'GitHub',    url: 'https://github.com/dhanifudin',              icon: '' },
  { label: 'LinkedIn',  url: 'https://www.linkedin.com/in/dhanifudin/',    icon: 'in' },
  { label: 'YouTube',   url: 'https://youtube.com/c/dhanifudin',           icon: '▶' },
  { label: 'Email',     url: 'mailto:dhanifudin@gmail.com',                icon: '✉' },
  { label: 'WhatsApp',  url: 'https://wa.me/6282230743546',              icon: '📱' },
];

// WhichKey binding map (used by WhichKey.vue)
export type KeyBinding =
  | { type: 'action'; key: string; icon: string; label: string }
  | { type: 'group';  key: string; icon: string; label: string; children: KeyBinding[] };

export const whichKeyBindings: KeyBinding[] = [
  { type: 'action', key: 'f', icon: '🔍', label: 'find file' },
  { type: 'action', key: 'e', icon: '▤',  label: 'explorer' },
  {
    type: 'group', key: 'g', icon: '↗', label: '+goto',
    children: [
      { type: 'action', key: 'h', icon: '⌂', label: 'dashboard' },
      { type: 'action', key: 'a', icon: '✎', label: 'about' },
      { type: 'action', key: 'b', icon: '▤', label: 'blog' },
      { type: 'action', key: 'p', icon: '▣', label: 'projects' },
    ],
  },
  {
    type: 'group', key: 'b', icon: '⊡', label: '+buffers',
    children: [
      { type: 'action', key: 'n', icon: '→', label: 'next buffer' },
      { type: 'action', key: 'p', icon: '←', label: 'prev buffer' },
    ],
  },
  { type: 'action', key: 't', icon: '◑', label: 'toggle theme' },
  { type: 'action', key: '?', icon: '?', label: 'keymaps' },
];

// Dashboard menu items (LazyVim alpha.nvim style)
export interface DashboardItem {
  key: string;
  icon: string;
  label: string;
  action: 'navigate' | 'palette' | 'external' | 'leader';
  /** path for navigate, url for external */
  target?: string;
  /** leader action for 'leader' type */
  leaderAction?: string;
}

export const dashboardItems: DashboardItem[] = [
  { key: 'f', icon: '🔍', label: 'Find File',           action: 'palette' },
  { key: 'n', icon: '✎',  label: 'New Issue / Suggest', action: 'external', target: 'https://github.com/dhanifudin/dhanifudin.github.io/issues/new/choose' },
  { key: 'a', icon: '👤',  label: 'About Me',            action: 'navigate', target: '/about' },
  { key: 'b', icon: '▤',  label: 'Blog',                action: 'navigate', target: '/blog' },
  { key: 'p', icon: '▣',  label: 'Projects',            action: 'navigate', target: '/projects' },
  { key: 'g', icon: '',  label: 'GitHub Profile',      action: 'external', target: 'https://github.com/dhanifudin' },
  { key: 'q', icon: '×',  label: 'Quit',                action: 'leader',   leaderAction: 'quit' },
];
