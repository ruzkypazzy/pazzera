/**
 * Create a Circle Developer-Controlled wallet set for Pazzera.
 *
 * Run after registering the entity secret in the Circle console.
 *
 * Usage:
 *   CIRCLE_API_KEY="TEST_API_KEY:xxx:yyy" \
 *     CIRCLE_ENTITY_SECRET="64-char-hex-from-gen-entity-secret" \
 *     npx tsx scripts/create-wallet-set.ts
 *
 * Prints the walletSetId to paste into Railway Variables.
 */
const API_KEY = process.env.CIRCLE_API_KEY;
const ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;

if (!API_KEY) {
  console.error('ERROR: set CIRCLE_API_KEY env var');
  process.exit(1);
}
if (!ENTITY_SECRET) {
  console.error('ERROR: set CIRCLE_ENTITY_SECRET env var (from gen-entity-secret.ts)');
  process.exit(1);
}

async function main() {
  console.log('=== CREATE PAZZERA WALLET SET ===\n');

  // Fetch public key
  const pkRes = await fetch('https://api.circle.com/v1/w3s/config/entity/publicKey', {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const pkJson: any = await pkRes.json();
  const publicKey = pkJson?.data?.publicKey ?? pkJson?.publicKey;
  if (!publicKey) {
    console.error('Failed to fetch public key:', JSON.stringify(pkJson, null, 2));
    process.exit(1);
  }
  console.log('1. Got Circle public key.\n');

  // Encrypt with PKCS1v1.5 (the only padding this key supports)
  const { publicEncrypt } = await import('node:crypto');
  let ciphertextB64: string;
  try {
    const ciphertext = publicEncrypt(
      { key: publicKey, padding: 6, oaepHash: 'sha256' },
      Buffer.from(ENTITY_SECRET, 'utf8'),
    );
    ciphertextB64 = ciphertext.toString('base64');
  } catch {
    const ciphertext = publicEncrypt(
      { key: publicKey, padding: 1 },
      Buffer.from(ENTITY_SECRET, 'utf8'),
    );
    ciphertextB64 = ciphertext.toString('base64');
  }
  console.log('2. Encrypted entity secret.\n');

  // Try multiple known wallet set creation endpoints
  const endpoints = [
    { path: '/v1/w3s/developer/walletSets', method: 'POST' },
    { path: '/v1/w3s/walletSets', method: 'POST' },
  ];

  for (const { path, method } of endpoints) {
    console.log(`3. Trying ${method} ${path}...`);
    const res = await fetch(`https://api.circle.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        name: 'Pazzera Users',
        entitySecretCiphertext: ciphertextB64,
      }),
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    console.log(`   Status: ${res.status}`);
    if (res.ok) {
      const walletSetId = json?.data?.walletSet?.id ?? json?.data?.id ?? json?.walletSet?.id;
      console.log(`   ✓ Created!`);
      console.log('');
      console.log('=== PASTE THIS INTO RAILWAY VARIABLES ===');
      console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
      console.log('');
      console.log('Then test:');
      console.log('   curl https://api.pazzera.com/api/debug/circle-setup');
      console.log('Should show: "ready": true');
      return;
    } else {
      console.log(`   Response: ${text.slice(0, 200)}`);
    }
  }

  console.error('\nFailed all endpoints. See responses above.');
  process.exit(1);
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });