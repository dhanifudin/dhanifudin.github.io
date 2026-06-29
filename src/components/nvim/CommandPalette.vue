<script setup lang="ts">
/**
 * CommandPalette.vue — Telescope-style fuzzy finder
 *
 * Opens with <leader>f or clicking the find icon.
 * Fuzzy-searches pages + blog posts + projects.
 * Loads a static search-index.json for full-text body search.
 * Keyboard: ↑/↓ or Ctrl-j/k move; Enter navigates; Esc closes.
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useLeader } from './useLeader';
import type { PageDef } from '../../data/site';

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

interface PaletteItem {
  type: 'page' | 'post' | 'project';
  title: string;
  subtitle: string;
  icon: string;
  path: string;
  _content?: string;
}

interface FilteredItem extends PaletteItem {
  snippet?: string;
  relevance: 'title' | 'description' | 'content';
}

interface BlogMeta   { id: string; title: string; path: string; date?: string; tags?: string[] }
interface ProjectMeta { id: string; title: string; path: string; tags?: string[] }

const props = defineProps<{
  pages:     PageDef[];
  blogPosts: BlogMeta[];
  projects:  ProjectMeta[];
}>();

const { paletteOpen, closePalette } = useLeader();

const query      = ref('');
const selected   = ref(0);
const inputRef   = ref<HTMLInputElement | null>(null);
const searchData = ref<Map<string, SearchEntry>>(new Map());

async function loadSearchIndex() {
  try {
    const res = await fetch('/search-index.json');
    if (!res.ok) return;
    const entries: SearchEntry[] = await res.json();
    const map = new Map<string, SearchEntry>();
    for (const e of entries) {
      map.set(e.path, e);
    }
    searchData.value = map;
  } catch {
    // search index is optional; fall back to title/subtitle matching
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  loadSearchIndex();
});

onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

const allItems = computed<PaletteItem[]>(() => [
  ...props.pages.map(p => ({
    type: 'page' as const,
    title: p.label,
    subtitle: p.path,
    icon: p.icon,
    path: p.path,
  })),
  ...props.blogPosts.map(p => {
    const idx = searchData.value.get(p.path);
    return {
      type: 'post' as const,
      title: p.title,
      subtitle: p.date ?? '',
      icon: '✎',
      path: p.path,
      _content: idx?.content || idx?.description || '',
    };
  }),
  ...props.projects.map(p => {
    const idx = searchData.value.get(p.path);
    return {
      type: 'project' as const,
      title: p.title,
      subtitle: (p.tags ?? []).join(', '),
      icon: '◈',
      path: p.path,
      _content: idx?.content || idx?.description || '',
    };
  }),
]);

function fuzzyMatch(text: string, pattern: string) {
  const t = text.toLowerCase();
  const p = pattern.toLowerCase();
  if (!p) return true;
  let ti = 0;
  for (let pi = 0; pi < p.length; pi++) {
    const found = t.indexOf(p[pi], ti);
    if (found === -1) return false;
    ti = found + 1;
  }
  return true;
}

function generateSnippet(content: string, query: string): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();

  let idx = lowerContent.indexOf(lowerQuery);
  if (idx === -1) {
    let ti = 0;
    for (let pi = 0; pi < lowerQuery.length; pi++) {
      const found = lowerContent.indexOf(lowerQuery[pi], ti);
      if (found === -1) break;
      ti = found + 1;
      if (pi === 0) idx = found;
    }
  }

  if (idx === -1) return '';

  const snippetLen = 150;
  const contextBefore = Math.floor((snippetLen - query.length) / 2);
  const start = Math.max(0, idx - contextBefore);
  const end = Math.min(content.length, start + snippetLen);

  let snippet = content.slice(start, end);
  if (start > 0) snippet = '\u2026' + snippet;
  if (end < content.length) snippet += '\u2026';

  return snippet;
}

function highlightSnippet(snippet: string, query: string): string {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const pattern = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');

  return snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(regex, '<mark class="search-match">$1</mark>');
}

const filtered = computed<FilteredItem[]>(() => {
  const q = query.value.trim();
  if (!q) return allItems.value.map(item => ({
    ...item,
    relevance: 'title' as const,
  }));

  const results: FilteredItem[] = [];

  for (const item of allItems.value) {
    const titleMatch = fuzzyMatch(item.title, q);
    const subtitleMatch = fuzzyMatch(item.subtitle, q);
    const contentMatch = item._content ? fuzzyMatch(item._content, q) : false;

    if (!titleMatch && !subtitleMatch && !contentMatch) continue;

    let relevance: FilteredItem['relevance'];
    let snippet: string | undefined;

    if (titleMatch) {
      relevance = 'title';
    } else if (subtitleMatch) {
      relevance = 'description';
    } else if (contentMatch && item._content) {
      relevance = 'content';
      snippet = generateSnippet(item._content, q);
    } else {
      relevance = 'title';
    }

    results.push({ ...item, relevance, snippet });
  }

  const order = { title: 0, description: 1, content: 2 };
  results.sort((a, b) => order[a.relevance] - order[b.relevance]);

  return results;
});

function close() {
  query.value = '';
  selected.value = 0;
  closePalette();
}

function confirm() {
  const item = filtered.value[selected.value];
  if (item) {
    close();
    window.location.href = item.path;
  }
}

watch(paletteOpen, async (open) => {
  if (open) {
    selected.value = 0;
    query.value = '';
    await nextTick();
    inputRef.value?.focus();
  }
});

function onKeyDown(e: KeyboardEvent) {
  if (!paletteOpen.value) return;
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      close();
      break;
    case 'ArrowUp':
    case 'k':
      if (e.ctrlKey || e.key === 'ArrowUp') {
        e.preventDefault();
        selected.value = (selected.value - 1 + filtered.value.length) % filtered.value.length;
      }
      break;
    case 'ArrowDown':
    case 'j':
      if (e.ctrlKey || e.key === 'ArrowDown') {
        e.preventDefault();
        selected.value = (selected.value + 1) % filtered.value.length;
      }
      break;
    case 'Enter':
      e.preventDefault();
      confirm();
      break;
  }
}
</script>

<template>
  <Transition name="tel">
    <div
      v-if="paletteOpen"
      :style="{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '80px',
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(4px)',
      }"
      @click.self="close"
    >
      <div
        :style="{
          background: 'var(--ctp-mantle)',
          border: '1px solid var(--ctp-surface1)',
          borderRadius: '10px',
          width: '600px',
          maxWidth: '90vw',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '70vh',
        }"
      >
        <!-- Telescope header -->
        <div
          :style="{
            padding: '8px 12px 4px',
            borderBottom: '1px solid var(--ctp-surface0)',
            color: 'var(--ctp-mauve)',
            fontSize: '11px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }"
        >
          <span>🔍</span>
          <span>Telescope  ·  Find File</span>
        </div>

        <!-- Search input (prompt line) -->
        <div
          :style="{
            display: 'flex',
            alignItems: 'center',
            padding: '8px 12px',
            gap: '6px',
            borderBottom: '1px solid var(--ctp-surface0)',
          }"
        >
          <span :style="{ color: 'var(--ctp-green)', fontWeight: '600' }">▶</span>
          <input
            ref="inputRef"
            v-model="query"
            placeholder="Search…"
            :style="{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--ctp-text)',
              fontFamily: 'inherit',
              fontSize: '14px',
            }"
            @input="selected = 0"
          />
          <span :style="{ color: 'var(--ctp-overlay0)', fontSize: '11px' }">
            {{ filtered.length }} results
          </span>
        </div>

        <!-- Results -->
        <div :style="{ overflowY: 'auto', flex: 1 }">
          <div
            v-for="(item, idx) in filtered"
            :key="item.path"
            :style="{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              padding: '7px 12px',
              cursor: 'pointer',
              background: idx === selected ? 'var(--ctp-surface0)' : 'transparent',
              borderLeft: idx === selected ? '2px solid var(--ctp-blue)' : '2px solid transparent',
              transition: 'background 0.08s',
            }"
            @click="selected = idx; confirm()"
            @mouseenter="selected = idx"
          >
            <span :style="{ color: 'var(--ctp-blue)', flexShrink: 0, width: '16px', paddingTop: '1px' }">{{ item.icon }}</span>
            <div :style="{ flex: 1, overflow: 'hidden', minWidth: 0 }">
              <div :style="{ display: 'flex', alignItems: 'center', gap: '6px' }">
                <span
                  :style="{
                    color: idx === selected ? 'var(--ctp-text)' : 'var(--ctp-subtext1)',
                    fontSize: '13px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    minWidth: 0,
                  }"
                >{{ item.title }}</span>
                <span
                  v-if="item.relevance === 'content'"
                  :style="{
                    padding: '1px 5px',
                    background: 'var(--ctp-peach)',
                    color: 'var(--ctp-crust)',
                    borderRadius: '3px',
                    fontSize: '9px',
                    fontWeight: '600',
                    flexShrink: 0,
                    textTransform: 'uppercase',
                  }"
                >match</span>
              </div>
              <div
                v-if="item.snippet"
                :style="{
                  color: 'var(--ctp-overlay1)',
                  fontSize: '11px',
                  marginTop: '2px',
                  lineHeight: '1.4',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }"
                v-html="highlightSnippet(item.snippet, query)"
              />
              <div
                v-else
                :style="{
                  color: 'var(--ctp-overlay0)',
                  fontSize: '11px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }"
              >{{ item.subtitle }}</div>
            </div>
            <span
              :style="{
                padding: '1px 6px',
                background: 'var(--ctp-surface1)',
                borderRadius: '3px',
                fontSize: '10px',
                color: 'var(--ctp-overlay1)',
                flexShrink: 0,
              }"
            >{{ item.type }}</span>
          </div>

          <div
            v-if="filtered.length === 0"
            :style="{
              padding: '24px',
              textAlign: 'center',
              color: 'var(--ctp-overlay0)',
              fontSize: '13px',
            }"
          >
            No results for "{{ query }}"
          </div>
        </div>

        <!-- Footer key hints -->
        <div
          :style="{
            padding: '6px 12px',
            borderTop: '1px solid var(--ctp-surface0)',
            display: 'flex',
            gap: '16px',
            fontSize: '11px',
            color: 'var(--ctp-overlay0)',
          }"
        >
          <span><kbd :style="{ padding: '0 4px', background: 'var(--ctp-surface0)', borderRadius: '3px' }">↑↓</kbd> navigate</span>
          <span><kbd :style="{ padding: '0 4px', background: 'var(--ctp-surface0)', borderRadius: '3px' }">Enter</kbd> open</span>
          <span><kbd :style="{ padding: '0 4px', background: 'var(--ctp-surface0)', borderRadius: '3px' }">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.tel-enter-active,
.tel-leave-active {
  transition: opacity 0.15s ease;
}
.tel-enter-from,
.tel-leave-to {
  opacity: 0;
}
.tel-enter-active .container,
.tel-leave-active .container {
  transition: transform 0.15s ease;
}

:deep(.search-match) {
  background: var(--ctp-surface0);
  color: var(--ctp-peach);
  font-weight: 600;
  border-radius: 1px;
  padding: 0 1px;
}
</style>
