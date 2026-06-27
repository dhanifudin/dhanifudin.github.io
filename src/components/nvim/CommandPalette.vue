<script setup lang="ts">
/**
 * CommandPalette.vue — Telescope-style fuzzy finder
 *
 * Opens with <leader>f or clicking the find icon.
 * Fuzzy-searches pages + blog posts + projects.
 * Keyboard: ↑/↓ or Ctrl-j/k move; Enter navigates; Esc closes.
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useLeader } from './useLeader';
import type { PageDef } from '../../data/site';

interface PaletteItem {
  type: 'page' | 'post' | 'project';
  title: string;
  subtitle: string;
  icon: string;
  path: string;
}

interface BlogMeta   { id: string; title: string; path: string; date?: string; tags?: string[] }
interface ProjectMeta { id: string; title: string; path: string; tags?: string[] }

const props = defineProps<{
  pages:     PageDef[];
  blogPosts: BlogMeta[];
  projects:  ProjectMeta[];
}>();

const { paletteOpen, closePalette } = useLeader();

const query    = ref('');
const selected = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

// Build full item list
const allItems = computed<PaletteItem[]>(() => [
  ...props.pages.map(p => ({
    type: 'page' as const,
    title: p.label,
    subtitle: p.path,
    icon: p.icon,
    path: p.path,
  })),
  ...props.blogPosts.map(p => ({
    type: 'post' as const,
    title: p.title,
    subtitle: p.date ?? '',
    icon: '✎',
    path: p.path,
  })),
  ...props.projects.map(p => ({
    type: 'project' as const,
    title: p.title,
    subtitle: (p.tags ?? []).join(', '),
    icon: '◈',
    path: p.path,
  })),
]);

// Simple fuzzy filter
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

const filtered = computed<PaletteItem[]>(() => {
  const q = query.value.trim();
  if (!q) return allItems.value;
  return allItems.value.filter(item =>
    fuzzyMatch(item.title, q) || fuzzyMatch(item.subtitle, q)
  );
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

// Focus input when opened
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

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
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
              alignItems: 'center',
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
            <span :style="{ color: 'var(--ctp-blue)', flexShrink: 0, width: '16px' }">{{ item.icon }}</span>
            <div :style="{ flex: 1, overflow: 'hidden' }">
              <div
                :style="{
                  color: idx === selected ? 'var(--ctp-text)' : 'var(--ctp-subtext1)',
                  fontSize: '13px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }"
              >{{ item.title }}</div>
              <div
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
</style>
