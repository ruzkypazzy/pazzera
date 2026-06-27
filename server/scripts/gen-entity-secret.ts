/**
 * Generate a Circle entity secret locally + print the value to use.
 *
 * Why this script:
 *   Circle's Configurator UI expects an entity secret to be provided.
 *   Some Circle API endpoints for registering ciphertexts return 404 on
 *   testnet. The cleanest path is: generate locally -> paste into UI.
 *
 * Usage:
 *   npx tsx scripts/gen-entity-secret.ts
 *
 * Output: prints a single 64-char hex string. Save it. Paste it into
 * the Circle Configurator UI on the "Entity Secret" page. Circle's UI
 * then internally encrypts it with their public key + registers.
 */
import { randomBytes } from 'node:crypto';

const secret = randomBytes(32).toString('hex');
console.log('');
console.log('PAZZERA ENTITY SECRET');
console.log('======================');
console.log('');
console.log(secret);
console.log('');
console.log('Steps:');
console.log('1. Save this secret somewhere safe (you only see it once)');
console.log('2. Go to console.circle.com -> your Pazzera app -> Configurator');
console.log('3. Find the "Entity Secret" field (may say "Entity Secret Ciphertext")');
console.log('4. Click "Generate" / "Show" if Circle auto-generates one');
console.log('   OR paste this raw 64-char hex value into the field');
console.log('5. Click "Register"');
console.log('6. After register succeeds, Circle will show your wallet set IDs');
console.log('7. Run the wallet set creation:');
console.log('   npx tsx scripts/create-wallet-set.ts');
console.log('');
console.log('Also set CIRCLE_ENTITY_SECRET=' + secret + ' in Railway Variables');