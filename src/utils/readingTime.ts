const WORDS_PER_MINUTE = 200;

export function getReadingTime(body: string | undefined): number {
  if (!body) return 1;
  return Math.max(1, Math.ceil(body.split(/\s+/).length / WORDS_PER_MINUTE));
}

export function formatReadingTime(body: string | undefined): string {
  return `~${getReadingTime(body)} min read`;
}
