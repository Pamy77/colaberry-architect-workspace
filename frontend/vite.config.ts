import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend (STORY-001..011) serves the API on :3001. In dev we proxy /api to
// it so the dashboard can call GET /api/kpis without any CORS setup.
const apiProxy = {
  '/api': { target: 'http://localhost:3001', changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 3000, proxy: apiProxy },
  preview: { port: 3000, proxy: apiProxy },
});
