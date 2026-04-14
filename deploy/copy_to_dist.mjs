/**
 * Cross-platform replacement for deploy/copy_to_dist.sh (Windows has no bash by default).
 * Run after webpack so dist/ gets static assets + wasm + emoji sprites.
 */
import { cpSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const distArg = process.argv[2];
const dist = resolve(root, distArg && distArg.trim() ? distArg : 'dist');

for (const name of readdirSync(join(root, 'public'))) {
  cpSync(join(root, 'public', name), join(dist, name), { recursive: true });
}

cpSync(join(root, 'src/lib/rlottie/rlottie-wasm.wasm'), join(dist, 'rlottie-wasm.wasm'));
cpSync(
  join(root, 'node_modules/opus-recorder/dist/decoderWorker.min.wasm'),
  join(dist, 'decoderWorker.min.wasm'),
);
cpSync(join(root, 'node_modules/emoji-data-ios/img-apple-64'), join(dist, 'img-apple-64'), {
  recursive: true,
});
cpSync(join(root, 'node_modules/emoji-data-ios/img-apple-160'), join(dist, 'img-apple-160'), {
  recursive: true,
});
