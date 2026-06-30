import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { formatReadingTime } from '../utils/readingTime';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog', ({ data }) => !data.draft).catch(() => []);

  return rss({
    title: 'Dian Hanifudin Subhi — Blog',
    description: 'Cloud engineer, backend developer & lecturer. Technology-agnostic, CLI-first.',
    site: context.site!,
    items: posts
      .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime())
      .map((post) => ({
        title: post.data.title,
        description: `${formatReadingTime(post.body)} — ${post.data.description}`,
        pubDate: post.data.date,
        link: `/blog/${post.id}/`,
        categories: post.data.tags,
      })),
    customData: `<language>en-us</language>`,
  });
}
