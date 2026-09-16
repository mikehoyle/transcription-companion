import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so tests don't pull in the build-only
// prerender plugin (it spins up a second Vite server) or the React plugin,
// which nothing here needs.
export default defineConfig({
  test: {
    // Most of what's worth testing is pure maths; the few files that need DOM
    // APIs opt in with a `@vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
