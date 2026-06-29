import type { AstroIntegration } from 'astro';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

function stripMarkdown(md: string): string {
  let text = md
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text;
}

interface FrontmatterData {
  title?: string;
  description?: string;
  tags?: string[];
  draft?: boolean;
  date?: string;
  url?: string;
  repo?: string;
  featured?: boolean;
  order?: number;
}

function parseFrontmatter(raw: string): { data: FrontmatterData; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---[\r\n]+([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };

  const data: FrontmatterData = {};
  const yamlBlock = match[1];

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      (data as Record<string, unknown>)[key] = value
        .slice(1, -1)
        .split(',')
        .map((s: string) => s.trim().replace(/^["']|["']$/g, ''));
    } else {
      (data as Record<string, unknown>)[key] = value;
    }
  }

  return { data, body: match[2] };
}

function findContentFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findContentFiles(fullPath));
      } else if (/\.(md|mdx)$/.test(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory doesn't exist or is empty
  }
  return results;
}

interface SearchEntry {
  id: string;
  type: 'post' | 'project';
  title: string;
  description: string;
  tags: string[];
  path: string;
  content: string;
  date?: string;
}

export function searchIndex(): AstroIntegration {
  return {
    name: 'search-index',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const searchEntries: SearchEntry[] = [];
        const cwd = process.cwd();

        const blogDir = join(cwd, 'src', 'content', 'blog');
        for (const file of findContentFiles(blogDir)) {
          const raw = readFileSync(file, 'utf-8');
          const { data, body } = parseFrontmatter(raw);
          if (data.draft && data.draft !== 'false') continue;

          searchEntries.push({
            id: basename(file).replace(/\.(md|mdx)$/, ''),
            type: 'post',
            title: data.title || '',
            description: data.description || '',
            tags: data.tags || [],
            path: `/blog/${basename(file).replace(/\.(md|mdx)$/, '')}`,
            content: stripMarkdown(body),
            date: data.date ? String(data.date).slice(0, 10) : '',
          });
        }

        const projectsDir = join(cwd, 'src', 'content', 'projects');
        for (const file of findContentFiles(projectsDir)) {
          const raw = readFileSync(file, 'utf-8');
          const { data, body } = parseFrontmatter(raw);

          searchEntries.push({
            id: basename(file).replace(/\.(md|mdx)$/, ''),
            type: 'project',
            title: data.title || '',
            description: data.description || '',
            tags: data.tags || [],
            path: `/projects/${basename(file).replace(/\.(md|mdx)$/, '')}`,
            content: stripMarkdown(body),
          });
        }

        const outDir = fileURLToPath(dir);
        writeFileSync(join(outDir, 'search-index.json'), JSON.stringify(searchEntries));

        logger.info(`search-index: generated ${searchEntries.length} entries`);
      },
    },
  };
}
