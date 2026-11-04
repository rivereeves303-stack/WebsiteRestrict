import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !['.git', 'node_modules', 'dist'].includes(entry.name)) await checkDirectory(join(directory, entry.name));
    if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', join(directory, entry.name)], { stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
await checkDirectory(root);
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('manifest.json 与 package.json 的版本不一致');
for (const file of pkg.files) await access(join(root, file));
console.log('JavaScript syntax, package files and version checks passed.');
