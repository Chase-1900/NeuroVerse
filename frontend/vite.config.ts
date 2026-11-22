import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL('../fixtures', import.meta.url))] } },
})
