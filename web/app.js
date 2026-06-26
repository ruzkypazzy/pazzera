// Pazzera web app — vanilla JS, real Circle Web SDK + Arc x402.
//
// Flow:
//   1. /api/play/signup → backend creates a Circle W3S user + wallet on Arc
//   2. frontend executes the creation challenge via @circle-fin/w3s-pw-web-sdk
//      (the SDK shows the OTP/email/PIN UI to the user — no MetaMask needed)
//   3. user clicks play → /api/play/start returns an EIP-712 challenge
//   4. frontend calls sdk.execute(signChallengeId) → user signs in hosted UI
//   5. frontend POSTs signature to /api/play/confirm → backend verifies +
//      submits to Circle Gateway facilitator → returns settlement UUID
//   6. frontend polls /api/play/settlement/:id until batch tx appears

const API = window.PAZZERA_API ?? 'http://localhost:3001';
const APP_ID = window.PAZZERA_APP_ID ?? ''; // injected via env in production

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const session = {
  fanEmail: localStorage.getItem('pazzera_fan_email') || null,
  fanUserId: localStorage.getItem('pazzera_fan_user_id') || null,
  fanWallet: JSON.parse(localStorage.getItem('pazzera_fan_wallet') || 'null'),
  artistId: localStorage.getItem('pazzera_artist_id') || null,
  artistName: localStorage.getItem('pazzera_artist_name') || null,
  nowPlaying: null,
  userToken: localStorage.getItem('pazzera_user_token') || null,
  encryptionKey: localStorage.getItem('pazzera_encryption_key') || null,
};

function saveSession() {
  localStorage.setItem('pazzera_fan_email', session.fanEmail ?? '');
  localStorage.setItem('pazzera_fan_user_id', session.fanUserId ?? '');
  localStorage.setItem('pazzera_fan_wallet', JSON.stringify(session.fanWallet ?? null));
  localStorage.setItem('pazzera_artist_id', session.artistId ?? '');
  localStorage.setItem('pazzera_artist_name', session.artistName ?? '');
  localStorage.setItem('pazzera_user_token', session.userToken ?? '');
  localStorage.setItem('pazzera_encryption_key', session.encryptionKey ?? '');
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  return res.json();
}

// ─── Circle Web SDK loader (lazy) ──────────────────────────
// Imported dynamically because the SDK is heavy and we don't want it on
// every page render. Cached after first load.
let circleSdkPromise = null;
async function loadCircleSdk() {
  if (!circleSdkPromise) {
    circleSdkPromise = import('https://cdn.jsdelivr.net/npm/@circle-fin/w3s-pw-web-sdk@latest/+esm')
      .then(m => m.W3SSdk ? new m.W3SSdk({ appSettings: { appId: APP_ID } }) : null)
      .catch(e => { console.error('SDK load failed', e); return null; });
  }
  return circleSdkPromise;
}

// ─── Router ────────────────────────────────────────────────
const routes = {
  '/': renderBrowse,
  '/artist/signup': renderArtistSignup,
  '/artist/:id': renderArtist,
  '/dashboard': renderDashboard,
  '/about': renderAbout,
};

function parseRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  for (const pattern of Object.keys(routes)) {
    if (pattern.includes(':')) {
      const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
      const m = hash.match(re);
      if (m) return { handler: routes[pattern], params: m.groups };
    } else if (pattern === hash) {
      return { handler: routes[pattern], params: {} };
    }
  }
  return { handler: renderBrowse, params: {} };
}

async function router() {
  const { handler, params } = parseRoute();
  $('#dashboardLink').hidden = !session.artistId;
  await handler(params);
}
window.addEventListener('hashchange', router);

// ─── Browse ────────────────────────────────────────────────
async function renderBrowse() {
  const app = $('#app');
  app.innerHTML = `
    <section class="hero">
      <h1>Pay per listen.</h1>
      <p class="lede">Independent artists upload a track, set a price per play, and earn USDC on Arc — settled in under 500ms via Circle Gateway + x402. No subscriptions, no platform cut.</p>
      <div class="row">
        <a class="btn primary" href="#/artist/signup">Become an artist</a>
        <a class="btn ghost" href="#/about">How it works</a>
      </div>
    </section>
    <h2>Recent tracks</h2>
    <div class="grid" id="catalog"><div class="card">Loading…</div></div>
  `;

  try {
    const { tracks } = await api('/api/tracks');
    const grid = $('#catalog');
    if (tracks.length === 0) {
      grid.innerHTML = `<div class="card"><p class="lede" style="margin:0">No tracks yet. <a href="#/artist/signup">Be the first</a>.</p></div>`;
      return;
    }
    grid.innerHTML = tracks.map(trackCard).join('');
    wireTrackCards();
  } catch (e) {
    $('#catalog').innerHTML = `<div class="card">Couldn't load tracks: ${e.message}</div>`;
  }
}

function trackCard(t) {
  const cover = t.cover_url ? `<div class="cover"><img src="${escapeHtml(t.cover_url)}" alt=""></div>` : `<div class="cover">♪</div>`;
  return `
    <div class="card" data-track-id="${t.id}">
      ${cover}
      <p class="track-title">${escapeHtml(t.title)}</p>
      <p class="artist-name">${escapeHtml(t.artist_name)}</p>
      <div class="row between">
        <span class="price">$${t.price_per_listen_usdc} / listen</span>
        <button class="btn primary" data-play="${t.id}">▶ Play</button>
      </div>
    </div>
  `;
}

function wireTrackCards() {
  $$('[data-play]').forEach(btn => btn.addEventListener('click', () => startPlayFlow(btn.dataset.play)));
}

// ─── Play flow ─────────────────────────────────────────────
async function startPlayFlow(trackId) {
  if (!session.fanEmail) {
    const email = await promptEmail();
    if (!email) return;
    await signupFan(email);
  }
  if (!session.fanWallet) {
    toast('Wallet not ready yet — try again in a moment');
    return;
  }

  // 1. Get x402 challenge
  const start = await api('/api/play/start', {
    method: 'POST',
    body: JSON.stringify({ trackId, fanEmail: session.fanEmail }),
  });

  showPlayerBar(start.track, start.artist, start.skip);

  if (start.skip) {
    toast(`Free play (${start.reason === 'replay_cooldown' ? 'replay cooldown' : 'skip-gated'})`, 'good');
    // still play audio for free
    playAudio(start.track.audio_url, 0);
    return;
  }

  toast(`Sign in your wallet to pay $${start.challenge.valueUsdc} for this play.`);

  // 2. Sign the EIP-712 TransferWithAuthorization
  const audio = $('#player');
  audio.src = start.track.audio_url;
  try { await audio.play(); } catch {}

  session.nowPlaying = {
    trackId,
    title: start.track.title,
    artistName: start.artist.display_name,
    startedAt: Date.now(),
    settled: false,
  };
  session._challenge = start.challenge;

  // 3. Try to sign — two paths
  try {
    const sig = await signTransferWithAuthorization(start.challenge);
    if (!sig) {
      // User cancelled or skipped under 10s
      return;
    }
    session._signedAuth = sig;
  } catch (e) {
    console.error(e);
    toast(`Signing failed: ${e.message}. You can still listen but the artist won't be paid unless you sign.`);
  }
}

function playAudio(url, _) {
  const audio = $('#player');
  audio.src = url;
  audio.play().catch(() => {});
}

// ─── Sign the EIP-712 challenge ────────────────────────────
// Path A: Circle Web SDK (preferred). Calls sdk.execute(signChallengeId) and
// the SDK pops the hosted UI for the user to approve the signature.
//
// Path B: window.ethereum (MetaMask etc). Calls eth_signTypedData_v4.
// Requires the wallet to be on Arc Testnet (chain ID 5042002).
async function signTransferWithAuthorization(challenge) {
  // Path A — Circle SDK
  if (APP_ID) {
    const sdk = await loadCircleSdk();
    if (sdk) {
      try {
        // Ask the backend to create a "sign challenge" for this user.
        // The backend would call circle.createTransaction(...) or a dedicated
        // sign endpoint depending on the W3S schema. For the hackathon demo
        // we surface the typed data via a simple modal — the SDK accepts it.
        const result = await signViaCircleSdk(sdk, challenge);
        if (result) return result;
      } catch (e) {
        console.warn('[circle sdk]', e);
      }
    }
  }

  // Path B — window.ethereum / MetaMask
  if (window.ethereum) {
    return await signViaMetaMask(challenge);
  }

  throw new Error('No wallet available. Set CIRCLE_APP_ID or install MetaMask on Arc Testnet.');
}

async function signViaCircleSdk(sdk, challenge) {
  // Real flow: backend POSTs to circle /v1/w3s/users/{userId}/sign with the
  // typed data → gets challengeId → frontend sdk.execute(challengeId) → user
  // approves in hosted UI → returns signature.
  const r = await fetch(API + '/api/play/sign-challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-token': session.userToken ?? '' },
    body: JSON.stringify({ challenge }),
  });
  if (!r.ok) throw new Error('sign-challenge failed: ' + r.status);
  const { challengeId } = await r.json();
  if (!challengeId) return null;

  return new Promise((resolve, reject) => {
    sdk.execute(challengeId, (err, result) => {
      if (err) return reject(err);
      // result.data?.signature?.signature is the 0x... 65-byte EIP-712 signature
      const signature = result?.data?.signature?.signature ?? result?.signature;
      if (!signature) return reject(new Error('no signature in SDK result'));
      resolve({
        payer: challenge.payer,
        payee: challenge.payee,
        value: challenge.value,
        validAfter: challenge.validAfter,
        validBefore: challenge.validBefore,
        nonce: challenge.nonce,
        signature,
      });
    });
  });
}

async function signViaMetaMask(challenge) {
  const eth = window.ethereum;
  const accounts = await eth.request({ method: 'eth_requestAccounts' });
  const chainIdHex = await eth.request({ method: 'eth_chainId' });
  if (parseInt(chainIdHex, 16) !== 5042002) {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x4CEF52' }],
    }).catch(async () => {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x4CEF52',
          chainName: 'Arc Testnet',
          rpcUrls: [process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'],
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          blockExplorerUrls: ['https://testnet.arcscan.app'],
        }],
      });
    });
  }
  const signature = await eth.request({
    method: 'eth_signTypedData_v4',
    params: [accounts[0], JSON.stringify(challenge.eip712)],
  });
  return {
    payer: challenge.payer,
    payee: challenge.payee,
    value: challenge.value,
    validAfter: challenge.validAfter,
    validBefore: challenge.validBefore,
    nonce: challenge.nonce,
    signature,
  };
}

// ─── Confirm play (called when audio ends or pauses) ────────
function wirePlayer() {
  const audio = $('#player');
  if (!audio) return;

  audio.addEventListener('ended', async () => {
    if (!session.nowPlaying || session.nowPlaying.settled) return;
    const listened = Math.floor(audio.currentTime);
    await confirmPlay(Math.max(listened, 1));
  });
  audio.addEventListener('pause', async () => {
    if (!session.nowPlaying || session.nowPlaying.settled) return;
    const listened = Math.floor(audio.currentTime);
    if (listened > 0) await confirmPlay(listened);
  });
}

async function confirmPlay(listenedSeconds) {
  if (session.nowPlaying.settled) return;
  session.nowPlaying.settled = true;
  const trackId = session.nowPlaying.trackId;
  const auth = session._signedAuth;
  const skip = listenedSeconds < 10 || !auth;

  try {
    const res = await api('/api/play/confirm', {
      method: 'POST',
      body: JSON.stringify({
        trackId,
        fanEmail: session.fanEmail,
        listenedSeconds,
        auth: skip ? undefined : auth,
      }),
    });
    if (res.skipped) {
      toast(`Skipped (${listenedSeconds}s) — no charge`, 'good');
    } else if (res.ok) {
      toast(`✓ Paid $${res.charged} to ${session.nowPlaying.artistName} · settlement ${res.settlementId.slice(0, 8)}…`, 'good');
      // Poll for on-chain batch tx
      pollSettlement(res.settlementId);
    } else {
      toast(`Payment failed: ${res.failReason}`, '');
    }
  } catch (e) {
    toast(`Confirm failed: ${e.message}`);
  }
}

async function pollSettlement(id) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const s = await api(`/api/play/settlement/${id}`);
      if (s.batchTx) {
        toast(`On-chain: ${s.explorerUrl}`, 'good');
        window.open(s.explorerUrl, '_blank');
        return;
      }
    } catch {}
  }
}

// ─── Player bar ────────────────────────────────────────────
function showPlayerBar(track, artist, skip) {
  $('#playerBar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'playerBar';
  bar.className = 'player-bar visible';
  const cover = track.cover_url ? `<img src="${escapeHtml(track.cover_url)}" style="width:100%;height:100%;object-fit:cover">` : '♪';
  bar.innerHTML = `
    <div class="cover">${cover}</div>
    <div class="info">
      <div class="title">${escapeHtml(track.title)}</div>
      <div class="meta">${escapeHtml(artist.display_name)} · $${track.price_per_listen_usdc}/listen${skip ? ' · free' : ''}</div>
    </div>
  `;
  document.body.appendChild(bar);
}

// ─── Fan signup modal ──────────────────────────────────────
function promptEmail() {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal">
        <h2>One step to listen</h2>
        <p class="lede">Enter your email. We create a Circle wallet for you on Arc Testnet, pre-funded with testnet USDC. No seed phrase, no MetaMask required.</p>
        <label>Email</label>
        <input type="email" id="emailInput" placeholder="you@example.com" autofocus />
        <div class="row" style="margin-top:18px;justify-content:flex-end;gap:8px">
          <button class="btn ghost" id="cancelBtn">Cancel</button>
          <button class="btn primary" id="okBtn">Continue</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);
    const input = $('#emailInput', back);
    input.focus();
    const close = (val) => { back.remove(); resolve(val); };
    $('#cancelBtn', back).onclick = () => close(null);
    $('#okBtn', back).onclick = () => close(input.value.trim() || null);
    back.addEventListener('click', e => { if (e.target === back) close(null); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') close(input.value.trim() || null); });
  });
}

async function signupFan(email) {
  try {
    const res = await api('/api/play/signup', { method: 'POST', body: JSON.stringify({ email }) });
    session.fanEmail = email;
    session.fanUserId = email; // Circle userId == our email-keyed id
    session.fanWallet = res.wallet;
    saveSession();
    toast(`Wallet ${res.wallet.address.slice(0, 10)}… created on ${res.network}. Fund it at faucet.circle.com to start listening.`, 'good');
  } catch (e) {
    toast(`Signup failed: ${e.message}`);
    throw e;
  }
}

// ─── Artist signup ─────────────────────────────────────────
async function renderArtistSignup() {
  const app = $('#app');
  app.innerHTML = `
    <h1>Become an artist</h1>
    <p class="lede">Sign up, upload a track, set a price. Earn USDC per listen, settled on Arc.</p>
    <div style="max-width:480px">
      <label>Email</label>
      <input type="email" id="su_email" placeholder="you@example.com" />
      <label>Display name</label>
      <input type="text" id="su_name" placeholder="Your artist name" />
      <label>Bio (optional)</label>
      <textarea id="su_bio" rows="3"></textarea>
      <div class="row" style="margin-top:18px"><button class="btn primary" id="su_submit">Create artist account</button></div>
    </div>
  `;
  $('#su_submit').onclick = async () => {
    const email = $('#su_email').value.trim();
    const displayName = $('#su_name').value.trim();
    const bio = $('#su_bio').value.trim();
    if (!email || !displayName) return toast('Email and display name required.');
    try {
      const { artist } = await api('/api/artists/signup', {
        method: 'POST',
        body: JSON.stringify({ email, displayName, bio }),
      });
      session.artistId = artist.id;
      session.artistName = artist.display_name;
      saveSession();
      location.hash = '#/dashboard';
      toast('Artist account created.', 'good');
    } catch (e) { toast(`Signup failed: ${e.message}`); }
  };
}

// ─── Artist page ───────────────────────────────────────────
async function renderArtist({ id }) {
  const app = $('#app');
  try {
    const { artist, tracks } = await api(`/api/artists/${id}`);
    app.innerHTML = `
      <h1>${escapeHtml(artist.display_name)}</h1>
      ${artist.bio ? `<p class="lede">${escapeHtml(artist.bio)}</p>` : ''}
      <div class="row" style="margin-bottom:18px">
        <span class="stat"><strong>${tracks.length}</strong> tracks</span>
        <span class="stat">wallet <strong>${artist.wallet_address.slice(0,8)}…</strong></span>
      </div>
      <h2>Tracks</h2>
      <div class="grid">${tracks.length === 0 ? '<div class="card">No tracks yet.</div>' : tracks.map(trackCard).join('')}</div>
    `;
    wireTrackCards();
  } catch (e) { app.innerHTML = `<div class="card">Couldn't load: ${e.message}</div>`; }
}

// ─── Dashboard ─────────────────────────────────────────────
async function renderDashboard() {
  const app = $('#app');
  if (!session.artistId) {
    app.innerHTML = `<h1>Dashboard</h1><p class="lede">Sign up as an artist first.</p><a class="btn primary" href="#/artist/signup">Become an artist</a>`;
    return;
  }
  try {
    const d = await api(`/api/dashboard/${session.artistId}`);
    app.innerHTML = `
      <h1>${escapeHtml(d.artist.display_name)} — dashboard</h1>
      <div class="row" style="gap:12px;margin-bottom:24px">
        <span class="stat"><strong>${d.totals.plays}</strong> plays</span>
        <span class="stat"><strong>$${d.totals.earningsUsdc}</strong> USDC earned</span>
        <span class="stat">${d.tracks.length} tracks</span>
      </div>
      <h2>Your tracks</h2>
      <table>
        <thead><tr><th>Title</th><th>Price</th><th>Plays</th><th>Earned</th><th></th></tr></thead>
        <tbody>
          ${d.tracks.map(t => `
            <tr>
              <td>${escapeHtml(t.title)}</td>
              <td>$${t.price_per_listen_usdc}</td>
              <td>${t.plays_count}</td>
              <td>$${Number(t.earnings_usdc).toFixed(6)}</td>
              <td><button class="btn ghost" data-play="${t.id}">Preview</button></td>
            </tr>`).join('')}
        </tbody>
      </table>

      <h2 style="margin-top:32px">Upload a new track</h2>
      <div style="max-width:480px">
        <label>Title</label><input type="text" id="up_title" />
        <label>Audio URL</label><input type="text" id="up_audio" placeholder="https://..." />
        <label>Cover URL (optional)</label><input type="text" id="up_cover" />
        <label>Duration (seconds)</label><input type="text" id="up_duration" />
        <label>Price per listen (USDC)</label><input type="text" id="up_price" value="0.001" />
        <div class="row" style="margin-top:14px"><button class="btn primary" id="up_submit">Upload</button></div>
      </div>

      <h2 style="margin-top:32px">Recent settled plays</h2>
      ${d.recentPlays.length === 0 ? '<p class="lede">No plays yet.</p>' : `
        <table>
          <thead><tr><th>When</th><th>Track</th><th>Fan</th><th>Amount</th><th>Settlement</th></tr></thead>
          <tbody>
            ${d.recentPlays.map(p => `
              <tr>
                <td>${new Date(p.created_at).toLocaleString()}</td>
                <td>${escapeHtml(p.track_title)}</td>
                <td>${p.fan_wallet_address.slice(0,10)}…</td>
                <td>$${p.charged_usdc}</td>
                <td class="txhash">${(p.settlement_tx_hash || '').slice(0,14)}…</td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    `;
    wireTrackCards();
    $('#up_submit').onclick = async () => {
      const body = {
        artistId: session.artistId,
        title: $('#up_title').value.trim(),
        audioUrl: $('#up_audio').value.trim(),
        coverUrl: $('#up_cover').value.trim(),
        durationSeconds: Number($('#up_duration').value),
        pricePerListenUsdc: $('#up_price').value.trim() || '0.001',
      };
      if (!body.title || !body.audioUrl || !body.durationSeconds) return toast('Title, audio URL, duration required.');
      try {
        await api('/api/tracks', { method: 'POST', body: JSON.stringify(body) });
        toast('Track uploaded.', 'good');
        router();
      } catch (e) { toast(`Upload failed: ${e.message}`); }
    };
  } catch (e) { app.innerHTML = `<div class="card">Couldn't load: ${e.message}</div>`; }
}

// ─── About ─────────────────────────────────────────────────
async function renderAbout() {
  const app = $('#app');
  let stats = null;
  try { stats = await api('/api/admin/stats'); } catch {}
  app.innerHTML = `
    <h1>How Pazzera works</h1>
    <p class="lede">Every play moves a fraction of a USDC cent from the fan's wallet to the artist — settled on Arc in under 500ms.</p>

    <h2>The flow</h2>
    <ol style="color:var(--fg-mute);max-width:60ch">
      <li>Fan enters email → backend creates a Circle W3S wallet on Arc Testnet.</li>
      <li>Fan funds the wallet at <a href="https://faucet.circle.com" target="_blank">faucet.circle.com</a> (Circle ships testnet USDC).</li>
      <li>Fan hits play → backend issues an x402 challenge (EIP-712 TransferWithAuthorization).</li>
      <li>Wallet signs the typed data → frontend POSTs to <code>/api/play/confirm</code>.</li>
      <li>Backend verifies the signature, submits to <strong>Circle Gateway facilitator</strong>, gets a settlement UUID.</li>
      <li>Relayer batches many settlements → one on-chain <code>submitBatch</code> tx on Arc → payment final in &lt;500ms.</li>
    </ol>

    <h2>Skip-gating (the agent decides)</h2>
    <ul style="color:var(--fg-mute);max-width:60ch">
      <li>Listen &lt; 10 seconds → free, no signature required</li>
      <li>Replay within 30 seconds → free</li>
      <li>Full listen → signature required, settles on Arc</li>
    </ul>

    ${stats ? `
      <h2>Live stats</h2>
      <div class="row" style="gap:12px;flex-wrap:wrap">
        <span class="stat"><strong>${stats.artists}</strong> artists</span>
        <span class="stat"><strong>${stats.tracks}</strong> tracks</span>
        <span class="stat"><strong>${stats.plays}</strong> plays (${stats.settledPlays} settled)</span>
        <span class="stat"><strong>$${Number(stats.totalUsdc).toFixed(6)}</strong> USDC settled</span>
        <span class="stat">${stats.network}</span>
      </div>` : ''}
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

window.addEventListener('DOMContentLoaded', () => { router(); wirePlayer(); });