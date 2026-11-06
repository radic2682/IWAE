import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // 순수 TS 테스트는 가벼운 node 환경에서 돈다. React 를 실제로
    // 렌더해야 하는 .tsx 테스트만 파일 첫 줄 주석으로 jsdom 을 쓴다.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/ui/test-setup.ts'],
  },
})
