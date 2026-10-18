import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
      // EPUB commentary export loads this ESM pipeline in the main process.
      // Bundle it together so packaged startup does not depend on the packager's
      // placement of shared, transitive micromark dependencies.
      exclude: [
        'unified',
        'remark-parse',
        'remark-frontmatter',
        'remark-gfm',
        'remark-math',
        'remark-rehype',
        'rehype-highlight',
        'rehype-katex',
        'rehype-stringify',
        'micromark-core-commonmark',
        'hast-util-to-jsx-runtime',
        'katex'
      ]
    })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    resolve: { alias: { '@renderer': resolve(__dirname, 'src/renderer/src') } },
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react()]
  }
})
