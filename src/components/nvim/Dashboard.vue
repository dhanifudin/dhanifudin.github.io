<script setup lang="ts">
/**
 * Dashboard.vue — dashboard.nvim / alpha-nvim style homepage
 *
 * ASCII header · shortcut menu · footer stats + socials.
 * Every shortcut is wired through the keyboard controller.
 */
import { onMounted, onUnmounted } from 'vue';
import { useLeader, openPalette } from './useLeader';
import { dashboardItems, socials, profile } from '../../data/site';
import type { DashboardItem } from '../../data/site';

const props = defineProps<{ buildDate?: string; postCount?: number; projectCount?: number }>();

const { toggleTheme } = useLeader();

function activate(item: DashboardItem) {
  switch (item.action) {
    case 'navigate':
      if (item.target) window.location.href = item.target;
      break;
    case 'palette':
      openPalette();
      break;
    case 'external':
      if (item.target) window.open(item.target, '_blank', 'noopener,noreferrer');
      break;
    case 'leader':
      if (item.leaderAction === 'quit') window.history.back();
      break;
  }
}

function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
  const item = dashboardItems.find(d => d.key === e.key);
  if (item) { e.preventDefault(); activate(item); }
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div
    :style="{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100%',
      padding: '2rem 1rem',
      gap: '2rem',
      color: 'var(--ctp-text)',
    }"
  >
    <!-- ── ASCII header ─────────────────────────────────────────────────── -->
    <div
      :style="{
        textAlign: 'center',
        lineHeight: 1.1,
      }"
    >
      <pre
        :style="{
          color: 'var(--ctp-blue)',
          fontSize: 'clamp(4px, 1.1vw, 9px)',
          fontFamily: 'inherit',
          letterSpacing: '0.02em',
          display: 'inline-block',
          textAlign: 'left',
        }"
      >
██████╗ ██╗  ██╗ █████╗ ███╗   ██╗██╗███████╗██╗   ██╗██████╗ ██╗███╗   ██╗
██╔══██╗██║  ██║██╔══██╗████╗  ██║██║██╔════╝██║   ██║██╔══██╗██║████╗  ██║
██║  ██║███████║███████║██╔██╗ ██║██║█████╗  ██║   ██║██║  ██║██║██╔██╗ ██║
██║  ██║██╔══██║██╔══██║██║╚██╗██║██║██╔══╝  ██║   ██║██║  ██║██║██║╚██╗██║
██████╔╝██║  ██║██║  ██║██║ ╚████║██║██║     ╚██████╔╝██████╔╝██║██║ ╚████║
╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝      ╚═════╝ ╚═════╝ ╚═╝╚═╝  ╚═══╝</pre>
      <div :style="{ color: 'var(--ctp-subtext0)', fontSize: '13px', marginTop: '4px' }">
        {{ profile.role }}  ·  {{ profile.location }}
      </div>
    </div>

    <!-- ── Tagline ─────────────────────────────────────────────────────── -->
    <div
      :style="{
        color: 'var(--ctp-subtext1)',
        fontSize: '13px',
        textAlign: 'center',
        maxWidth: '460px',
      }"
    >
      {{ profile.tagline }}
    </div>

    <!-- ── Menu ───────────────────────────────────────────────────────── -->
    <div
      :style="{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        width: '300px',
        maxWidth: '90vw',
      }"
    >
      <button
        v-for="item in dashboardItems"
        :key="item.key"
        :style="{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: '13px',
          color: 'var(--ctp-text)',
          textAlign: 'left',
          transition: 'background 0.1s',
          width: '100%',
        }"
        @click="activate(item)"
        @mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--ctp-surface0)'"
        @mouseleave="($event.currentTarget as HTMLElement).style.background = 'transparent'"
      >
        <!-- Key badge -->
        <kbd
          :style="{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '22px',
            height: '20px',
            background: 'var(--ctp-surface0)',
            border: '1px solid var(--ctp-surface1)',
            borderRadius: '4px',
            color: 'var(--ctp-blue)',
            fontSize: '12px',
            fontFamily: 'inherit',
            fontWeight: '600',
            flexShrink: 0,
          }"
        >{{ item.key }}</kbd>

        <!-- Icon -->
        <span :style="{ color: 'var(--ctp-blue)', flexShrink: 0 }">{{ item.icon }}</span>

        <!-- Label -->
        <span>{{ item.label }}</span>

        <!-- External indicator -->
        <span
          v-if="item.action === 'external'"
          :style="{ marginLeft: 'auto', color: 'var(--ctp-overlay0)', fontSize: '11px' }"
        >↗</span>
      </button>
    </div>

    <!-- ── Footer stats + socials ─────────────────────────────────────── -->
    <div
      :style="{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        marginTop: '0.5rem',
      }"
    >
      <!-- Stats line (α-nvim / lazy.nvim style) -->
      <div
        :style="{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          color: 'var(--ctp-overlay0)',
          fontSize: '12px',
        }"
      >
        <span>⚡</span>
        <span>{{ postCount ?? 0 }} posts</span>
        <span :style="{ color: 'var(--ctp-surface1)' }">·</span>
        <span>{{ projectCount ?? 0 }} projects</span>
        <span :style="{ color: 'var(--ctp-surface1)' }">·</span>
        <span>built {{ buildDate ?? new Date().getFullYear() }}</span>
      </div>

      <!-- Socials -->
      <div
        :style="{
          display: 'flex',
          gap: '16px',
          color: 'var(--ctp-overlay1)',
          fontSize: '18px',
        }"
      >
        <a
          v-for="social in socials"
          :key="social.label"
          :href="social.url"
          :title="social.label"
          target="_blank"
          rel="noopener noreferrer"
          :style="{
            color: 'var(--ctp-overlay1)',
            textDecoration: 'none',
            transition: 'color 0.1s',
          }"
          @mouseenter="($event.currentTarget as HTMLAnchorElement).style.color = 'var(--ctp-blue)'"
          @mouseleave="($event.currentTarget as HTMLAnchorElement).style.color = 'var(--ctp-overlay1)'"
        >{{ social.icon }}</a>
      </div>

      <!-- Theme toggle hint -->
      <div :style="{ color: 'var(--ctp-overlay0)', fontSize: '11px' }">
        Press <kbd
          :style="{ padding: '0 4px', background: 'var(--ctp-surface0)', borderRadius: '3px' }"
        >Space</kbd> for keybindings  ·  <button
          :style="{
            background: 'none',
            border: 'none',
            color: 'var(--ctp-mauve)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 'inherit',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          }"
          @click="toggleTheme"
        >toggle theme</button>
      </div>
    </div>
  </div>
</template>
