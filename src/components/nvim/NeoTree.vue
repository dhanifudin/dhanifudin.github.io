<script setup lang="ts">
/**
 * NeoTree.vue — Neo-tree file explorer sidebar
 *
 * Mirrors neo-tree.nvim's panel: tree header, pages as "files", blog/projects
 * as expandable directory nodes. Keyboard: j/k move, Enter navigate.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useLeader } from './useLeader';
import type { PageDef } from '../../data/site';

interface BlogMeta { id: string; title: string; path: string }
interface ProjectMeta { id: string; title: string; path: string }

const props = defineProps<{
  currentPath: string;
  blogPosts:   BlogMeta[];
  projects:    ProjectMeta[];
  pages:       PageDef[];
}>();

const { neoTreeOpen } = useLeader();

// Expanded state for directory nodes
const expanded = ref<Record<string, boolean>>({
  '/blog':     false,
  '/projects': false,
});

// Build flat item list for j/k navigation
type TreeItem =
  | { kind: 'page';    page: PageDef }
  | { kind: 'dir';     path: string; label: string; icon: string }
  | { kind: 'child';   parent: string; label: string; path: string; icon: string };

const items = computed<TreeItem[]>(() => {
  const out: TreeItem[] = [];
  for (const page of props.pages) {
    if (page.path === '/blog') {
      out.push({ kind: 'dir', path: '/blog', label: 'blog', icon: '▤' });
      if (expanded.value['/blog']) {
        for (const post of props.blogPosts) {
          out.push({ kind: 'child', parent: '/blog', label: post.title, path: post.path, icon: '✎' });
        }
      }
    } else if (page.path === '/projects') {
      out.push({ kind: 'dir', path: '/projects', label: 'projects', icon: '▣' });
      if (expanded.value['/projects']) {
        for (const proj of props.projects) {
          out.push({ kind: 'child', parent: '/projects', label: proj.title, path: proj.path, icon: '◈' });
        }
      }
    } else {
      out.push({ kind: 'page', page });
    }
  }
  return out;
});

const focusedIdx = ref(0);

function isActive(path: string) {
  const p = props.currentPath.endsWith('/') && props.currentPath !== '/'
    ? props.currentPath.slice(0, -1)
    : props.currentPath;
  return p === path;
}

function handleClick(item: TreeItem) {
  if (item.kind === 'dir') {
    expanded.value[item.path] = !expanded.value[item.path];
  } else if (item.kind === 'page') {
    window.location.href = item.page.path;
  } else {
    window.location.href = item.path;
  }
}

function onKey(e: KeyboardEvent) {
  if (!neoTreeOpen.value) return;
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

  if (e.key === 'j') {
    e.preventDefault();
    focusedIdx.value = (focusedIdx.value + 1) % items.value.length;
  } else if (e.key === 'k') {
    e.preventDefault();
    focusedIdx.value = (focusedIdx.value - 1 + items.value.length) % items.value.length;
  } else if (e.key === 'Enter') {
    const item = items.value[focusedIdx.value];
    if (item) { e.preventDefault(); handleClick(item); }
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <aside
    v-if="neoTreeOpen"
    class="neotree"
    :style="{
      width: '220px',
      minWidth: '220px',
      background: 'var(--ctp-mantle)',
      borderRight: '1px solid var(--ctp-surface0)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }"
  >
    <!-- Header -->
    <div
      :style="{
        padding: '6px 12px',
        borderBottom: '1px solid var(--ctp-surface0)',
        color: 'var(--ctp-mauve)',
        fontSize: '11px',
        fontWeight: '600',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }"
    >
      <span>▤</span>
      <span>NEO-TREE</span>
    </div>

    <!-- Root label -->
    <div
      :style="{
        padding: '4px 12px',
        fontSize: '11px',
        color: 'var(--ctp-overlay0)',
        userSelect: 'none',
        borderBottom: '1px solid var(--ctp-surface0)',
      }"
    >
      dhanifudin.github.io
    </div>

    <!-- Tree items -->
    <div
      :style="{
        flex: '1',
        overflowY: 'auto',
        padding: '4px 0',
      }"
    >
      <div
        v-for="(item, idx) in items"
        :key="idx"
        class="tree-item"
        :data-active="
          item.kind === 'page'  ? isActive(item.page.path) :
          item.kind === 'dir'   ? isActive(item.path) :
          isActive(item.path)
        "
        :data-focused="idx === focusedIdx"
        :data-child="item.kind === 'child'"
        :style="{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: item.kind === 'child' ? '2px 12px 2px 28px' : '2px 12px',
          cursor: 'pointer',
          userSelect: 'none',
          fontSize: '13px',
          borderLeft: (
            item.kind === 'page'  ? isActive(item.page.path) :
            item.kind === 'dir'   ? isActive(item.path) :
            isActive(item.path)
          ) ? '2px solid var(--ctp-blue)' : '2px solid transparent',
          background: (
            idx === focusedIdx
              ? 'var(--ctp-surface0)'
              : (
                  item.kind === 'page'  ? isActive(item.page.path) :
                  item.kind === 'dir'   ? isActive(item.path) :
                  isActive(item.path)
                ) ? 'var(--ctp-surface0)' : 'transparent'
          ),
          color: (
            item.kind === 'page'  ? isActive(item.page.path) :
            item.kind === 'dir'   ? isActive(item.path) :
            isActive(item.path)
          ) ? 'var(--ctp-blue)' : 'var(--ctp-text)',
          transition: 'background 0.1s',
        }"
        @click="handleClick(item)"
        @mouseenter="focusedIdx = idx"
      >
        <!-- Chevron for directories -->
        <span
          v-if="item.kind === 'dir'"
          :style="{ color: 'var(--ctp-overlay1)', fontSize: '10px', width: '10px' }"
        >
          {{ expanded[item.path] ? '▼' : '▶' }}
        </span>
        <span v-else :style="{ width: '10px', display: 'inline-block' }" />

        <!-- Icon -->
        <span :style="{ color: 'var(--ctp-blue)', flexShrink: 0 }">
          {{ item.kind === 'page' ? item.page.icon : item.icon }}
        </span>

        <!-- Label -->
        <span
          :style="{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }"
        >
          {{ item.kind === 'page' ? item.page.label : item.label }}
        </span>
      </div>
    </div>

    <!-- Footer hint -->
    <div
      :style="{
        padding: '4px 12px',
        borderTop: '1px solid var(--ctp-surface0)',
        fontSize: '11px',
        color: 'var(--ctp-overlay0)',
        userSelect: 'none',
      }"
    >
      j/k move  Enter open  <kbd>e</kbd> toggle
    </div>
  </aside>
</template>
