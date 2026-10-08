import { defineConfig } from 'vite';
import version from 'vite-plugin-package-version';
import injectHTML from 'vite-plugin-html-inject';

export default defineConfig({
  // Relative, so a build works under any GitHub Pages user/repo, any subpath and
  // behind a custom domain, without being rebuilt. Override with BASE when a
  // deploy needs absolute URLs.
  base: process.env.BASE || './',
  test: {
    environment: 'jsdom',
  },
  plugins: [version(), injectHTML()],
});
