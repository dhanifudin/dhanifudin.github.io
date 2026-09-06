import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { renderOgPng, type OgMeta } from '../../utils/og-render';

function fmtDate(date: Date): string {
  return date.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function getStaticPaths() {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  const projects = await getCollection('projects');

  const entries: { params: { route: string }; props: OgMeta }[] = [];

  const pages: Record<string, OgMeta> = {
    index: {
      title: 'Dashboard',
      description: 'Dian Hanifudin Subhi: Software Engineer personal site',
      routeLabel: '~',
      accent: 'peach',
    },
    about: {
      title: 'About',
      description: 'About Dian Hanifudin Subhi',
      routeLabel: '/about',
      accent: 'blue',
    },
    blog: {
      title: 'Blog',
      description: 'Writing by Dian Hanifudin Subhi',
      routeLabel: '/blog',
      accent: 'blue',
    },
    projects: {
      title: 'Projects',
      description: 'Projects by Dian Hanifudin Subhi',
      routeLabel: '/projects',
      accent: 'blue',
    },
    cv: {
      title: 'CV',
      description: 'Résumé / CV of Dian Hanifudin Subhi',
      routeLabel: '/cv',
      accent: 'blue',
    },
  };
  for (const [route, meta] of Object.entries(pages)) {
    entries.push({ params: { route }, props: meta });
  }

  for (const post of posts) {
    entries.push({
      params: { route: `blog/${post.id}` },
      props: {
        title: post.data.title,
        description: post.data.description,
        routeLabel: `/blog/${post.id}`,
        accent: 'mauve',
        date: fmtDate(post.data.date),
        tags: post.data.tags,
      },
    });
  }

  for (const project of projects) {
    entries.push({
      params: { route: `projects/${project.id}` },
      props: {
        title: project.data.title,
        description: project.data.description,
        routeLabel: `/projects/${project.id}`,
        accent: 'teal',
        tags: project.data.tags,
      },
    });
  }

  return entries;
}

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgPng(props as OgMeta);
  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
};
