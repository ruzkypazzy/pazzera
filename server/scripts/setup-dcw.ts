/**
 * One-shot setup script for Circle Developer-Controlled Wallets.
 *
 * Runs end-to-end:
 *   1. Generate a fresh 32-byte entity secret (hex)
 *   2. Fetch Circle's entity public key
 *   3. Encrypt the secret with the public key (RSA-OAEP-SHA256)
 *   4. Register the ciphertext with Circle
 *   5. Create a wallet set
 *   6. Print all the env vars you need to paste into Railway
 *
 * Usage:
 *   CIRCLE_API_KEY=TEST_API_KEY:xxx:yyy npx tsx scripts/setup-dcw.ts
 *
 * Output: prints everything to stdout. Save it.
 */
import { randomBytes, publicEncrypt } from 'node:crypto';

const API_KEY = process.env.CIRCLE_API_KEY;
if (!API_KEY) {
  console.error('ERROR: set CIRCLE_API_KEY env var first');
  console.error('  export CIRCLE_API_KEY="TEST_API_KEY:xxx:yyy"');
  console.error('  npx tsx scripts/setup-dcw.ts');
  process.exit(1);
}

async function main() {
  console.log('=== PAZZERA DCW SETUP ===\n');

  // 1. Generate entity secret
  const secret = randomBytes(32).toString('hex');
  console.log('1. ENTITY SECRET (save this):');
  console.log(`   ${secret}\n`);

  // 2. Fetch Circle's entity public key
  const pkRes = await fetch('https://api.circle.com/v1/w3s/config/entity/publicKey', {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const pkJson: any = await pkRes.json();
  if (!pkJson.ok && pkJson.code) {
    console.error('Failed to fetch public key:', JSON.stringify(pkJson, null, 2));
    process.exit(1);
  }
  // Try several response shapes
  const publicKey: string | undefined =
    pkJson?.data?.publicKey ??
    pkJson?.publicKey ??
    pkJson?.data?.pubKey ??
    (typeof pkJson === 'string' ? pkJson : undefined);
  if (!publicKey) {
    console.error('Public key response shape unknown:');
    console.error(JSON.stringify(pkJson, null, 2));
    process.exit(1);
  }
  console.log('2. Fetched Circle entity public key.\n');

  // 3. Encrypt
  const ciphertext = publicEncrypt(
    { key: publicKey, padding: 6, oaepHash: 'sha256' },  // RSA_PKCS1_OAEP_PADDING with SHA-256
    Buffer.from(secret, 'utf8'),
  );
  const ciphertextB64 = ciphertext.toString('base64');
  console.log('3. Encrypted entity secret (base64):');
  console.log(`   ${ciphertextB64.slice(0, 60)}...\n`);

  // 4. Register
  const regRes = await fetch('https://api.circle.com/v1/w3s/config/entity/secret', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entitySecretCiphertext: ciphertextB64 }),
  });
  const regText = await regRes.text();
  let regJson: any;
  try { regJson = JSON.parse(regText); } catch { regJson = { raw: regText }; }
  if (!regRes.ok) {
    console.error('FAILED to register entity secret:');
    console.error(`Status: ${regRes.status}`);
    console.error(JSON.stringify(regJson, null, 2));
    process.exit(1);
  }
  console.log('4. Entity secret registered with Circle ✓\n');

  // 5. Create wallet set
  const setRes = await fetch('https://api.circle.com/v1/w3s/developer/walletSets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: randomBytes(32).toString('hex'),
      name: 'Pazzera Users',
      entitySecretCiphertext: ciphertextB64,
    }),
  });
  const setText = await setRes.text();
  let setJson: any;
  try { setJson = JSON.parse(setText); } catch { setJson = { raw: setText }; }
  if (!setRes.ok) {
    console.error('FAILED to create wallet set:');
    console.error(`Status: ${setRes.status}`);
    console.error(JSON.stringify(setJson, null, 2));
    process.exit(1);
  }
  const walletSetId: string | undefined =
    setJson?.data?.walletSet?.id ??
    setJson?.walletSet?.id ??
    setJson?.data?.id;
  if (!walletSetId) {
    console.error('Wallet set created but response shape unknown:');
    console.error(JSON.stringify(setJson, null, 2));
    process.exit(1);
  }
  console.log('5. Wallet set created ✓\n');

  // 6. Print the env vars
  console.log('=== COPY THESE TO RAILWAY VARIABLES ===\n');
  console.log(`CIRCLE_ENTITY_SECRET=${secret}`);
  console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
  console.log('');
  console.log('After pasting, test with:');
  console.log('  curl https://api.pazzera.com/api/debug/circle-setup');
  console.log('Should show: "ready": true');
}

main().catch((e) => {
  console.error('UNEXPECTED ERROR:', e);
  process.exit(1);
});