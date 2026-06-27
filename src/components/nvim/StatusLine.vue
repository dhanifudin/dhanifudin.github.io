<script setup lang="ts">
/**
 * StatusLine.vue — lualine-style statusline
 *
 * Left: mode pill → git branch → filename
 * Right: filetype → line/col → flavor → clock
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useLeader } from './useLeader';
import type { PageDef } from '../../data/site';

const props = defineProps<{
  currentPath: string;
  pages: PageDef[];
}>();

const { toggleTheme } = useLeader();

// Clock
const clock = ref('');
function tick() {
  clock.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
let timer: ReturnType<typeof setInterval>;
onMounted(() => { tick(); timer = setInterval(tick, 10_000); });
onUnmounted(() => clearInterval(timer));

// Current page meta
const currentPage = computed<PageDef | undefined>(() =>
  props.pages.find(p => {
    const path = props.currentPath.endsWith('/') && props.currentPath !== '/'
      ? props.currentPath.slice(0, -1)
      : props.currentPath;
    return path === p.path || path.startsWith(p.path + '/');
  })
);

const filename = computed(() => {
  const path = props.currentPath;
  const segs = path.split('/').filter(Boolean);
  return segs.length ? segs[segs.length - 1] + '.md' : 'dashboard.astro';
});

const filetype = computed(() => currentPage.value?.ft ?? 'astro');

// Catppuccin flavor name from CSS variable
const flavor = ref('Latte');
function detectFlavor() {
  if (typeof document !== 'undefined') {
    const theme = document.documentElement.getAttribute('data-theme') ?? 'latte';
    flavor.value = theme === 'mocha' ? 'Mocha' : 'Latte';
  }
}
onMounted(() => {
  detectFlavor();
  // Watch for attribute changes
  const obs = new MutationObserver(detectFlavor);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  onUnmounted(() => obs.disconnect());
});
</script>

<template>
  <footer
    :style="{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '24px',
      background: 'var(--ctp-crust)',
      borderTop: '1px solid var(--ctp-surface0)',
      fontSize: '12px',
      flexShrink: 0,
      userSelect: 'none',
    }"
  >
    <!-- Left side -->
    <div :style="{ display: 'flex', alignItems: 'stretch', height: '100%' }">
      <!-- Mode pill -->
      <div
        :style="{
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          background: 'var(--ctp-blue)',
          color: 'var(--ctp-base)',
          fontWeight: '700',
          letterSpacing: '0.05em',
          fontSize: '11px',
          clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%)',
          paddingRight: '20px',
        }"
      >
        NORMAL
      </div>

      <!-- Git branch -->
      <div
        :style="{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '0 12px',
          color: 'var(--ctp-subtext1)',
          background: 'var(--ctp-mantle)',
          clipPath: 'polygon(8px 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0 50%)',
          paddingLeft: '18px',
          paddingRight: '18px',
        }"
      >
        <span>⎇</span>
        <span>main</span>
      </div>

      <!-- Filename -->
      <div
        :style="{
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          color: 'var(--ctp-text)',
          gap: '4px',
        }"
      >
        <span :style="{ color: 'var(--ctp-blue)' }">{{ currentPage?.icon ?? '⌂' }}</span>
        <span>{{ filename }}</span>
      </div>
    </div>

    <!-- Right side -->
    <div :style="{ display: 'flex', alignItems: 'stretch', height: '100%' }">
      <!-- Filetype -->
      <div
        :style="{
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          color: 'var(--ctp-subtext0)',
        }"
      >
        {{ filetype }}
      </div>

      <!-- Catppuccin flavor (toggle button) -->
      <button
        :style="{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '0 10px',
          background: 'var(--ctp-mantle)',
          border: 'none',
          color: 'var(--ctp-mauve)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          clipPath: 'polygon(8px 0, 100% 0, 100% 100%, 8px 100%, 0 50%)',
          paddingLeft: '16px',
        }"
        title="Toggle theme (⟨leader⟩ t)"
        @click="toggleTheme"
      >
        <span>◑</span>
        <span>{{ flavor }}</span>
      </button>

      <!-- Clock -->
      <div
        :style="{
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          background: 'var(--ctp-blue)',
          color: 'var(--ctp-base)',
          fontWeight: '600',
          clipPath: 'polygon(8px 0, 100% 0, 100% 100%, 8px 100%, 0 50%)',
          paddingLeft: '18px',
        }"
      >
        {{ clock }}
      </div>
    </div>
  </footer>
</template>
