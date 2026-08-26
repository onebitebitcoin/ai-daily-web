/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 포트 고정. 5173은 my-academy, 5175는 btc-daily-web이 쓴다.
    port: 5176,
    strictPort: true,
    // 백엔드도 btc-daily-web(8002)과 겹치지 않게 8003이다. 여기가 8002면
    // 개발 서버가 조용히 비트코인 에디션을 읽는다.
    proxy: { '/api': 'http://localhost:8003' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
