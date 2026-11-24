import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { shieldApi } from './server/api'

export default defineConfig({
  plugins: [react(), tailwindcss(), shieldApi()],
  server: {
    // the SQLite file changes as you play — don't let it trigger reloads
    watch: { ignored: ['**/data/**'] },
  },
})
