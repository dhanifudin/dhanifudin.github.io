<script setup lang="ts">
/**
 * KeyboardController — renderless Vue component
 *
 * Mounts a single global `keydown` listener that feeds the leader state
 * machine. Drop one instance into the EditorLayout; all other islands
 * read state via the shared useLeader singleton.
 */
import { onMounted, onUnmounted } from 'vue';
import { useLeader, openLeader, handleLeaderKey } from './useLeader';

const { state, paletteOpen } = useLeader();

function onKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  // Don't intercept typing in form fields
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  ) return;

  // If command palette is open, don't intercept (palette handles its own keys)
  if (paletteOpen.value) return;

  if (state.value === 'idle') {
    if (e.key === ' ') {
      e.preventDefault();
      openLeader();
    }
  } else {
    // Leader is active — consume the keypress
    e.preventDefault();
    handleLeaderKey(e.key);
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template><!-- renderless --></template>
