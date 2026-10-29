import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The demo catalog lives in ../data so the backend seed script can reuse it.
    fs: { allow: ['..'] },
    // The FastAPI backend will run on 7860 (same port Hugging Face uses).
    proxy: { '/api': 'http://localhost:7860' },
  },
})
