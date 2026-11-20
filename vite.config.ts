import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The page ships as one HTML file with the CSS and JS inlined: one request before first paint.
export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: { target: 'es2022', cssMinify: true },
});
