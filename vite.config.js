const { resolve } = require('path');
const { defineConfig } = require('vite');

module.exports = defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        notFound: resolve(__dirname, '404.html'),
      },
    },
  },
});
