import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [nodePolyfills()],
  define: {
    'window.PAZZERA_API':     JSON.stringify(process.env.PAZZERA_API     || 'http://localhost:3001'),
    'window.PAZZERA_APP_ID':  JSON.stringify(process.env.PAZZERA_APP_ID  || ''),
    'window.ARC_RPC_URL':     JSON.stringify(process.env.ARC_RPC_URL     || 'https://rpc.testnet.arc.network'),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});