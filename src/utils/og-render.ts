// ─── Open Graph image renderer (Sharp-based, build time only) ────────────────
// Renders a 1200x630 PNG for each route at build time. No external service is
// called at request time; everything is generated statically with sharp, which
// is already part of Astro's dependency tree.

import sharp from 'sharp';
import { profile } from '../data/site';
import type { OgAccent, OgMeta } from './og';

// Catppuccin Mocha palette (mirrors the tokens in src/styles/global.css).
const palette = {
  base: '#1e1e2e',
  crust: '#11111b',
  surface0: '#313244',
  surface1: '#45475a',
  overlay0: '#6c7086',
  subtext0: '#a6adc8',
  subtext1: '#bac2de',
  text: '#cdd6f4',
  blue: '#89b4fa',
  mauve: '#cba6f7',
  peach: '#fab387',
  teal: '#94e2d5',
} as const;

const ACCENT_HEX: Record<OgAccent, string> = {
  peach: palette.peach,
  blue: palette.blue,
  mauve: palette.mauve,
  teal: palette.teal,
};

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 64;
const INNER_WIDTH = WIDTH - PADDING * 2;

// Monospace advance width (~0.6em) for the system monospace fonts available in
// CI (DejaVu Sans Mono / Liberation Mono).
const CHAR_RATIO = 0.6;
const FONT = "'DejaVu Sans Mono', 'Liberation Mono', monospace";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Word-wrap a string for a monospace font, capped at `maxLines`. */
function wrapText(text: string, fontSize: number, maxWidth: number, maxLines: number): string[] {
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * CHAR_RATIO)));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  let overflowed = false;

  for (const word of words) {
    let remaining = word;
    while (remaining.length > maxChars) {
      if (current) {
        lines.push(current);
        current = '';
        if (lines.length === maxLines) {
          overflowed = true;
          break;
        }
      }
      lines.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
      if (lines.length === maxLines) {
        overflowed = true;
        break;
      }
    }
    if (overflowed) break;
    if (remaining.length === 0) continue;

    const candidate = current ? `${current} ${remaining}` : remaining;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      lines.push(current);
      if (lines.length === maxLines) {
        overflowed = true;
        break;
      }
      current = remaining;
    }
  }

  if (!overflowed && current) lines.push(current);

  if (overflowed) {
    lines.length = maxLines;
    const last = lines[maxLines - 1] ?? '';
    lines[maxLines - 1] = `${last.slice(0, maxChars - 1)}…`;
  }

  return lines;
}

function buildSvg(meta: OgMeta): string {
  const accent = ACCENT_HEX[meta.accent];
  const tags = (meta.tags ?? []).slice(0, 4);

  const titleLines = wrapText(meta.title, 64, INNER_WIDTH, 3);
  const descLines = meta.description ? wrapText(meta.description, 28, INNER_WIDTH, 2) : [];

  const headerCenterY = 84;
  const titleStartBaseline = 200;
  const titleLineHeight = 76;
  const descStartBaseline = 392;
  const descLineHeight = 36;
  const tagsTop = 470;
  const tagHeight = 34;
  const tagFont = 20;
  const dividerY = 540;
  const footerCenterY = 573;
  const badgeTop = 552;
  const badgeSize = 42;

  const parts: string[] = [];
  parts.push(
    `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
  );
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="${palette.base}"/>`);

  // Header: accent marker + breadcrumb (left), date or site URL (right).
  parts.push(
    `<rect x="${PADDING}" y="${headerCenterY - 13}" width="6" height="26" rx="3" fill="${accent}"/>`,
  );
  parts.push(
    `<text x="${PADDING + 20}" y="${headerCenterY}" dominant-baseline="central" font-family="${FONT}" font-size="22" font-weight="600" fill="${accent}">${escapeXml(meta.routeLabel)}</text>`,
  );
  parts.push(
    `<text x="${WIDTH - PADDING}" y="${headerCenterY}" dominant-baseline="central" font-family="${FONT}" font-size="22" fill="${palette.overlay0}" text-anchor="end">${escapeXml(meta.date ?? `${profile.handle}.github.io`)}</text>`,
  );

  // Title.
  titleLines.forEach((line, i) => {
    const y = titleStartBaseline + i * titleLineHeight;
    parts.push(
      `<text x="${PADDING}" y="${y}" font-family="${FONT}" font-size="64" font-weight="700" fill="${accent}">${escapeXml(line)}</text>`,
    );
  });

  // Description.
  descLines.forEach((line, i) => {
    const y = descStartBaseline + i * descLineHeight;
    parts.push(
      `<text x="${PADDING}" y="${y}" font-family="${FONT}" font-size="28" fill="${palette.subtext0}">${escapeXml(line)}</text>`,
    );
  });

  // Tags.
  let tagX = PADDING;
  for (const tag of tags) {
    const label = `#${tag}`;
    const textWidth = Math.ceil(label.length * tagFont * CHAR_RATIO);
    const badgeWidth = textWidth + 28;
    const badgeCenterY = tagsTop + tagHeight / 2;
    parts.push(
      `<rect x="${tagX}" y="${tagsTop}" width="${badgeWidth}" height="${tagHeight}" rx="${tagHeight / 2}" fill="${palette.surface0}"/>`,
    );
    parts.push(
      `<text x="${tagX + badgeWidth / 2}" y="${badgeCenterY}" dominant-baseline="central" font-family="${FONT}" font-size="${tagFont}" fill="${palette.text}" text-anchor="middle">${escapeXml(label)}</text>`,
    );
    tagX += badgeWidth + 12;
  }

  // Divider.
  parts.push(
    `<line x1="${PADDING}" y1="${dividerY}" x2="${WIDTH - PADDING}" y2="${dividerY}" stroke="${palette.surface0}" stroke-width="1"/>`,
  );

  // Footer: monogram badge + handle (left), author name (right).
  parts.push(
    `<rect x="${PADDING}" y="${badgeTop}" width="${badgeSize}" height="${badgeSize}" rx="10" fill="${palette.blue}"/>`,
  );
  parts.push(
    `<text x="${PADDING + badgeSize / 2}" y="${footerCenterY}" dominant-baseline="central" font-family="${FONT}" font-size="20" font-weight="700" fill="${palette.crust}" text-anchor="middle">${profile.handle.slice(0, 2)}</text>`,
  );
  parts.push(
    `<text x="${PADDING + badgeSize + 18}" y="${footerCenterY}" dominant-baseline="central" font-family="${FONT}" font-size="24" font-weight="600" fill="${palette.subtext1}">@${profile.handle}</text>`,
  );
  parts.push(
    `<text x="${WIDTH - PADDING}" y="${footerCenterY}" dominant-baseline="central" font-family="${FONT}" font-size="22" fill="${palette.subtext0}" text-anchor="end">${escapeXml(profile.name)}</text>`,
  );

  parts.push('</svg>');
  return parts.join('');
}

export async function renderOgPng(meta: OgMeta): Promise<Uint8Array> {
  const svg = buildSvg(meta);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
