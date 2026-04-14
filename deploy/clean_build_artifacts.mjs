/** Remove dist and common tool caches before a full production build. */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
for (const rel of ['dist', 'node_modules/.cache', '.cache']) {
  try {
    rmSync(resolve(root, rel), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
