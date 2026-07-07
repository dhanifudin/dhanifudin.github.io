import type { CollectionEntry } from 'astro:content';
import topicData from '../data/topics.json';

export interface RelatedPostEntry {
  post: CollectionEntry<'blog'>;
  score: number;
  matchedBy: 'series' | 'tags' | 'topic' | 'recent';
  matchedTags?: string[];
}

function getTagStream(tag: string): string | null {
  const lowerTag = tag.toLowerCase();
  for (const stream of topicData.streams) {
    if (stream.name.toLowerCase().includes(lowerTag)) return stream.name;
    for (const topic of stream.topics) {
      if (topic.toLowerCase().includes(lowerTag)) return stream.name;
    }
  }
  return null;
}

function getBestStream(tags: string[]): string | null {
  const counts: Record<string, number> = {};
  for (const tag of tags) {
    const stream = getTagStream(tag);
    if (stream) {
      counts[stream] = (counts[stream] || 0) + 1;
    }
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}

export function getRelatedPosts(
  allPosts: CollectionEntry<'blog'>[],
  currentId: string,
  currentTags: string[],
  currentSeriesId?: string,
  limit = 5,
): RelatedPostEntry[] {
  const lowerTags = currentTags.map((t) => t.toLowerCase());
  const candidates = allPosts.filter((p) => p.id !== currentId);

  const results: RelatedPostEntry[] = [];

  for (const candidate of candidates) {
    if (currentSeriesId && candidate.data.series?.id === currentSeriesId) {
      results.push({ post: candidate, matchedBy: 'series', score: 100 });
      continue;
    }

    const shared = lowerTags.filter((t) =>
      candidate.data.tags.map((ct) => ct.toLowerCase()).includes(t),
    );
    if (shared.length > 0) {
      results.push({
        post: candidate,
        matchedBy: 'tags',
        score: shared.length * 10,
        matchedTags: shared,
      });
      continue;
    }

    const currentStream = getBestStream(currentTags);
    const candidateStream = getBestStream(candidate.data.tags);
    if (currentStream && candidateStream && currentStream === candidateStream) {
      results.push({ post: candidate, matchedBy: 'topic', score: 1 });
      continue;
    }

    results.push({ post: candidate, matchedBy: 'recent', score: 0 });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (
      new Date(b.post.data.date).getTime() -
      new Date(a.post.data.date).getTime()
    );
  });

  return results.slice(0, limit);
}
