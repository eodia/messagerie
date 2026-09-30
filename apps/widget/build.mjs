/**
 * Builds the widget into one script, `dist/widget.js`, that a site loads with a single
 * `<script>` tag: no module, no stylesheet, no dependency of the page — a few tens of KB.
 */
import * as esbuild from 'esbuild'

const options = {
  entryPoints: ['src/main.tsx'],
  outfile: 'dist/widget.js',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  legalComments: 'none',
  logLevel: 'info',
}

if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options)
  await context.watch()
} else {
  await esbuild.build(options)
}
