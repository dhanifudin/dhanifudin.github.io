// ─── Open Graph image routing (pure helpers, no Node deps) ───────────────────
// Shares the route -> generated-image mapping between the /og endpoint and
// EditorLayout.astro so the og:image URL always points at a file that exists.

export type OgAccent = 'peach' | 'blue' | 'mauve' | 'teal';

export interface OgMeta {
  title: string;
  description?: string;
  /** breadcrumb shown on the card, e.g. "/blog/hello-neovim" */
  routeLabel: string;
  accent: OgAccent;
  date?: string;
  tags?: string[];
}

const STATIC_ROUTES = new Set(['index', 'about', 'blog', 'projects', 'cv']);

/** Map a site pathname to its generated OG image path, or null to fall back. */
export function ogImagePath(pathname: string): string | null {
  const route =
    pathname === '/' ? 'index' : pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!route) return '/og/index.png';
  if (STATIC_ROUTES.has(route)) return `/og/${route}.png`;
  if (route.startsWith('blog/') || route.startsWith('projects/')) {
    return `/og/${route}.png`;
  }
  return null;
}
