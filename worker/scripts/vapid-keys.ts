// Makes a VAPID key pair for turn notifications (Web Push; worker/src/push.ts).
// Usage: npm run vapid-keys            prints a key pair for staging or production
//        npm run vapid-keys -- --dev   writes one to worker/.dev.vars for `npm run worker:dev`
// Use a different pair for each environment, and keep it: devices that turned
// notifications on are tied to it, so a new pair means turning them on again.
// Runs with Node's built-in TypeScript support (Node 22.18 or later).
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toBase64Url } from '../src/push.ts';

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer));
const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey).d!;

if (process.argv.includes('--dev')) {
  const file = join(import.meta.dirname, '..', '.dev.vars');
  if (existsSync(file)) {
    console.error(`${file} already exists; not replacing it.`);
    process.exit(1);
  }
  writeFileSync(file, `# Local secrets for wrangler dev; never committed.\nVAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\n`);
  console.log(`Wrote a key pair to ${file}. Restart npm run worker:dev to use it.`);
} else {
  console.log(`Public key (VAPID_PUBLIC_KEY in that environment's [vars] in worker/wrangler.toml):\n\n  ${publicKey}\n`);
  console.log('Private key (a secret: paste it when asked, and keep it nowhere else):\n');
  console.log(`  ${privateKey}\n`);
  console.log('  npx wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.toml --env <staging|production>');
}
