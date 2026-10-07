import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
    // A phone reaches the Mac through `tailscale serve`, which keeps its *.ts.net name in the Host header.
    allowedHosts: ['.ts.net'],
  },
  // `pnpm phone` serves the build here; `tailscale serve` forwards to 127.0.0.1, not to the IPv6 localhost.
  // The proxy and allowed hosts carry over from `server`.
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
