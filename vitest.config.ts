import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Các test điền form dùng `await nextFrame()` + polling → cần thời gian hơn mặc định 5s.
    testTimeout: 20000,
  },
})
