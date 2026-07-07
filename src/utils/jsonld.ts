import type { CollectionEntry } from 'astro:content';
import { profile, socials } from '../data/site';

const SITE_URL = 'https://dhanifudin.github.io';

interface PersonLd {
  '@context': 'https://schema.org';
  '@type': 'Person';
  name: string;
  alternateName: string;
  jobTitle: string;
  description: string;
  url: string;
  sameAs: string[];
  image: string;
  worksFor?: {
    '@type': 'Organization';
    name: string;
    url: string;
  };
}

export function createPersonJsonLd(): PersonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.name,
    alternateName: profile.handle,
    jobTitle: profile.role,
    description: profile.tagline,
    url: SITE_URL,
    sameAs: socials.map(s => s.url),
    image: `${SITE_URL}/og-image.png`,
    worksFor: {
      '@type': 'Organization',
      name: 'Politeknik Negeri Malang (Polinema)',
      url: 'https://polinema.ac.id',
    },
  };
}

export function createBlogPostingJsonLd(
  post: CollectionEntry<'blog'>,
  postId: string,
): Record<string, unknown> {
  const { data } = post;
  const url = `${SITE_URL}/blog/${postId}`;

  const result: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: data.title,
    description: data.description,
    author: {
      '@type': 'Person',
      name: profile.name,
      url: SITE_URL,
    },
    datePublished: data.date.toISOString().split('T')[0],
    dateModified: data.date.toISOString().split('T')[0],
    url,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    image: `${SITE_URL}/og-image.png`,
    keywords: data.tags.join(', '),
  };

  if (data.series) {
    result.isPartOf = {
      '@type': 'CreativeWorkSeries',
      name: data.series.name,
      description: data.series.description,
      position: data.series.order,
    };
  }

  return result;
}

export function createSoftwareApplicationJsonLd(
  project: CollectionEntry<'projects'>,
  projectId: string,
): Record<string, unknown> {
  const { data } = project;
  const url = data.url || data.repo || `${SITE_URL}/projects/${projectId}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: data.title,
    description: data.description,
    url,
    author: {
      '@type': 'Person',
      name: profile.name,
      url: SITE_URL,
    },
    applicationCategory: 'DeveloperApplication',
    image: `${SITE_URL}/og-image.png`,
    ...(data.repo ? { sameAs: data.repo, codeRepository: data.repo } : {}),
    ...(data.url ? { url: data.url } : {}),
  };
}
