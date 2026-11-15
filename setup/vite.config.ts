import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Absolute root so it works from the repo root and from setup/ (tauri dev).
const uiRoot = fileURLToPath(new URL('./ui', import.meta.url))

export default defineConfig({
  root: uiRoot,
  publicDir: false,
  // Relative asset URLs: the window loads from the tauri:// origin.
  base: './',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { port: 5181, strictPort: true },
})
