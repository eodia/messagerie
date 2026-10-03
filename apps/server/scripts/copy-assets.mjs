/**
 * What `tsc` does not copy: the settings' model and the demonstration, read at run time
 * next to the compiled `settings/demo.js`.
 */
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist/settings', { recursive: true })
for (const name of ['model.json', 'demo.json']) {
  copyFileSync(`src/settings/${name}`, `dist/settings/${name}`)
}
