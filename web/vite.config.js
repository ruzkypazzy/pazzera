import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [nodePolyfills()],
  define: {
    'window.PAZZERA_API':    JSON.stringify(process.env.VITE_PAZZERA_API    ?? ''),
    'window.PAZZERA_APP_ID': JSON.stringify(process.env.VITE_PAZZERA_APP_ID ?? ''),
    'window.ARC_RPC_URL':    JSON.stringify(process.env.VITE_ARC_RPC_URL    ?? 'https://rpc.testnet.arc.network'),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});