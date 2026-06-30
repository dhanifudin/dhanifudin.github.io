import type { CollectionEntry } from 'astro:content';

export function getAdjacentPosts(
  posts: CollectionEntry<'blog'>[],
  currentSlug: string,
): { prev: CollectionEntry<'blog'> | null; next: CollectionEntry<'blog'> | null } {
  const idx = posts.findIndex((p) => p.id === currentSlug);
  if (idx === -1) return { prev: null, next: null };

  return {
    prev: idx < posts.length - 1 ? posts[idx + 1] : null,
    next: idx > 0 ? posts[idx - 1] : null,
  };
}
