<script setup lang="ts">
/**
 * BufferLine.vue — bufferline.nvim-style tab strip
 *
 * Shows each site page as a "buffer" tab with filetype icon. Active tab
 * underlined with accent color. Supports <leader>1-4 and bn/bp via
 * the shared keyboard controller.
 */
import type { PageDef } from '../../data/site';

const props = defineProps<{
  currentPath: string;
  pages: PageDef[];
}>();

function isActive(page: PageDef) {
  const path = props.currentPath.endsWith('/') && props.currentPath !== '/'
    ? props.currentPath.slice(0, -1)
    : props.currentPath;
  // Also match sub-paths (e.g. /blog/post → /blog tab is active)
  return path === page.path || path.startsWith(page.path + '/');
}

function navigate(page: PageDef) {
  window.location.href = page.path;
}
</script>

<template>
  <div
    :style="{
      display: 'flex',
      background: 'var(--ctp-crust)',
      borderBottom: '1px solid var(--ctp-surface0)',
      height: '36px',
      alignItems: 'stretch',
      overflowX: 'auto',
      flexShrink: 0,
    }"
    class="scrollbar-hide"
  >
    <!-- Tabs -->
    <button
      v-for="page in pages"
      :key="page.path"
      :data-active="isActive(page)"
      :style="{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '0 16px',
        background: 'transparent',
        border: 'none',
        borderBottom: isActive(page)
          ? '2px solid var(--ctp-blue)'
          : '2px solid transparent',
        color: isActive(page) ? 'var(--ctp-text)' : 'var(--ctp-overlay1)',
        cursor: 'pointer',
        fontSize: '13px',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        transition: 'color 0.1s, border-color 0.1s',
      }"
      @click="navigate(page)"
      @mouseenter="($event.currentTarget as HTMLElement).style.color = 'var(--ctp-subtext1)'"
      @mouseleave="($event.currentTarget as HTMLElement).style.color = isActive(page) ? 'var(--ctp-text)' : 'var(--ctp-overlay1)'"
    >
      <span :style="{ color: isActive(page) ? 'var(--ctp-blue)' : 'var(--ctp-overlay1)' }">
        {{ page.icon }}
      </span>
      <span>{{ page.label }}</span>
      <span
        v-if="isActive(page)"
        :style="{ color: 'var(--ctp-overlay0)', fontSize: '11px' }"
      >●</span>
    </button>

    <!-- Spacer -->
    <div :style="{ flex: 1 }" />

    <!-- Buffer index hint (right side, desktop only) -->
    <div
      class="buffer-hints"
      :style="{
        display: 'flex',
        alignItems: 'center',
        paddingRight: '12px',
        gap: '8px',
        color: 'var(--ctp-overlay0)',
        fontSize: '11px',
      }"
    >
      <span v-for="page in pages" :key="page.bufIdx">
        <kbd :style="{
          padding: '1px 5px',
          background: 'var(--ctp-surface0)',
          borderRadius: '3px',
          color: isActive(page) ? 'var(--ctp-blue)' : 'var(--ctp-overlay0)',
        }">{{ page.bufIdx }}</kbd>
      </span>
    </div>
  </div>
</template>
