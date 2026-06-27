<script setup lang="ts">
/**
 * WhichKey.vue — which-key.nvim popup
 *
 * Appears at the bottom when <leader> (Space) is pressed.
 * Shows grouped bindings; pressing a group key drills into its children.
 * Escape dismisses.
 */
import { computed } from 'vue';
import { useLeader } from './useLeader';
import { whichKeyBindings } from '../../data/site';
import type { KeyBinding } from '../../data/site';

const { state, whichKeyOpen, dismiss } = useLeader();

const currentBindings = computed<KeyBinding[]>(() => {
  if (state.value === 'sub:g') {
    const gGroup = whichKeyBindings.find(b => b.key === 'g' && b.type === 'group') as Extract<KeyBinding, { type: 'group' }> | undefined;
    return gGroup?.children ?? [];
  }
  if (state.value === 'sub:b') {
    const bGroup = whichKeyBindings.find(b => b.key === 'b' && b.type === 'group') as Extract<KeyBinding, { type: 'group' }> | undefined;
    return bGroup?.children ?? [];
  }
  return whichKeyBindings;
});

const groupTitle = computed(() => {
  if (state.value === 'sub:g') return '  goto';
  if (state.value === 'sub:b') return '⊡  buffers';
  return '  Normal Mode  ·  ⟨leader⟩ = Space';
});
</script>

<template>
  <Transition name="wk">
    <div
      v-if="whichKeyOpen"
      :style="{
        position: 'fixed',
        bottom: '24px',  /* above statusline */
        left: 0,
        right: 0,
        zIndex: 50,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }"
    >
      <div
        :style="{
          background: 'var(--ctp-mantle)',
          border: '1px solid var(--ctp-surface1)',
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          padding: '0',
          minWidth: '520px',
          maxWidth: '90vw',
          pointerEvents: 'all',
          overflow: 'hidden',
        }"
      >
        <!-- Title bar -->
        <div
          :style="{
            padding: '6px 16px',
            borderBottom: '1px solid var(--ctp-surface0)',
            color: 'var(--ctp-subtext1)',
            fontSize: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }"
        >
          <span>{{ groupTitle }}</span>
          <span :style="{ color: 'var(--ctp-overlay0)', fontSize: '11px' }">Esc to close</span>
        </div>

        <!-- Bindings grid -->
        <div
          :style="{
            padding: '10px 12px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '4px 8px',
          }"
        >
          <div
            v-for="binding in currentBindings"
            :key="binding.key"
            :style="{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 6px',
              borderRadius: '4px',
              cursor: binding.type === 'group' ? 'default' : 'pointer',
            }"
          >
            <!-- Key badge -->
            <kbd
              :style="{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '22px',
                padding: '1px 6px',
                background: 'var(--ctp-surface0)',
                border: '1px solid var(--ctp-surface1)',
                borderRadius: '4px',
                color: 'var(--ctp-blue)',
                fontSize: '12px',
                fontFamily: 'inherit',
                fontWeight: '600',
                flexShrink: 0,
              }"
            >{{ binding.key }}</kbd>

            <!-- Arrow -->
            <span :style="{ color: 'var(--ctp-overlay0)', fontSize: '11px' }">→</span>

            <!-- Icon + label -->
            <span :style="{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden' }">
              <span :style="{ flexShrink: 0 }">{{ binding.icon }}</span>
              <span
                :style="{
                  color: binding.type === 'group' ? 'var(--ctp-peach)' : 'var(--ctp-text)',
                  fontSize: '13px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }"
              >{{ binding.label }}</span>
            </span>
          </div>
        </div>

        <!-- Dismiss overlay click -->
        <div
          :style="{
            position: 'fixed',
            inset: 0,
            zIndex: -1,
          }"
          @click="dismiss"
        />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.wk-enter-active,
.wk-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.wk-enter-from,
.wk-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
