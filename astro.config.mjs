// @ts-check
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { searchIndex } from './src/integrations/search-index';

// https://astro.build/config
export default defineConfig({
  site: 'https://dhanifudin.github.io',
  integrations: [
    vue(),
    mdx(),
    sitemap({
      filter: (page) => {
        if (page.frontmatter?.draft === true) return false;
        return true;
      },
    }),
    searchIndex(),
  ],
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
