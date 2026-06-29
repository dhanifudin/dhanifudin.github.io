// @ts-check
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import { searchIndex } from './src/integrations/search-index';

// https://astro.build/config
export default defineConfig({
  site: 'https://dhanifudin.github.io',
  integrations: [vue(), mdx(), searchIndex()],
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    shikiConfig: {
      themes: {
        light: 'catppuccin-latte',
        dark: 'catppuccin-mocha',
      },
      wrap: true,
    },
  },
});
