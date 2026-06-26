// Pazzera web app — vanilla JS, real Circle Web SDK + Arc x402.
//
// Flow:
//   1. /api/auth/signup → backend creates user + Circle W3S user + wallet on Arc
//                         → returns { userToken, encryptionKey, challengeId }
//   2. frontend runs sdk.setAuthentication(userToken, encryptionKey) +
//      sdk.execute(challengeId) → Circle hosted UI pops → user sets PIN
//   3. /api/auth/complete-pin-setup → backend marks wallet ready
//   4. fan clicks play → /api/play/start returns an EIP-712 challenge
//   5. sdk.execute(signChallengeId) → user signs in hosted UI
//   6. POST signature to /api/play/confirm → backend verifies + submits
//   7. poll /api/play/settlement/:id until batch tx appears

const API = window.PAZZERA_API ?? '';     // empty = same origin (production)
const APP_ID = window.PAZZERA_APP_ID ?? '';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Session state
const session = {
  user: null,            // { id, email, display_name, role }
  wallet: null,          // { address, pinSetupComplete }
  userToken: null,
  encryptionKey: null,
  nowPlaying: null,
};

// Cookie-based session: just call /api/auth/me to know if logged in.
async function refreshSession() {
  try {
    const r = await fetch(API + '/api/auth/me', { credentials: 'include' });
    if (!r.ok) { session.user = null; session.wallet = null; return; }
    const data = await r.json();
    session.user = data.user;
    session.wallet = data.wallet;
  } catch {
    session.user = null;
    session.wallet = null;
  }
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    let detail;
    try { detail = (await res.json()).error ?? await res.text(); } catch { detail = await res.text(); }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ─── Circle Web SDK loader ─────────────────────────────────
let circleSdkPromise = null;
async function loadCircleSdk() {
  if (!circleSdkPromise) {
    circleSdkPromise = import('https://cdn.jsdelivr.net/npm/@circle-fin/w3s-pw-web-sdk@1.1.11/+esm')
      .then(m => m.W3SSdk ? new m.W3SSdk({ appSettings: { appId: APP_ID } }) : null)
      .catch(e => { console.error('SDK load failed', e); return null; });
  }
  return circleSdkPromise;
}

// ─── Router ────────────────────────────────────────────────
const routes = {
  '/': renderBrowse,
  '/login': renderLogin,
  '/signup': renderSignup,
  '/dashboard': renderDashboard,
  '/artist/:id': renderArtist,
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
  await refreshSession();
  updateNav();
  const { handler, params } = parseRoute();
  // Redirect to login if a guarded route
  const guarded = ['/dashboard'];
  const path = location.hash.replace(/^#/, '') || '/';
  if (guarded.includes(path) && !session.user) {
    location.hash = '#/login';
    return;
  }
  await handler(params);
}
window.addEventListener('hashchange', router);

function updateNav() {
  const loginLink = $('#loginLink');
  const signupLink = $('#signupLink');
  const dashLink = $('#dashboardLink');
  const logoutLink = $('#logoutLink');
  if (session.user) {
    loginLink.hidden = true;
    signupLink.hidden = true;
    dashLink.hidden = false;
    logoutLink.hidden = false;
    dashLink.textContent = session.user.role === 'artist' ? 'Dashboard' : 'My plays';
    logoutLink.onclick = (e) => { e.preventDefault(); logout(); };
  } else {
    loginLink.hidden = false;
    signupLink.hidden = false;
    dashLink.hidden = true;
    logoutLink.hidden = true;
  }
}

// ─── Browse ────────────────────────────────────────────────
async function renderBrowse() {
  const app = $('#app');
  app.innerHTML = `
    <section class="hero">
      <h1>Pay per listen.</h1>
      <p class="lede">Independent artists upload a track, set a price per play, and earn USDC on Arc — settled in under 500ms via Circle Gateway + x402. No subscriptions, no platform cut.</p>
      <div class="row">
        ${session.user
          ? `<a class="btn primary" href="#/dashboard">${session.user.role === 'artist' ? 'Your dashboard' : 'Browse as ' + escapeHtml(session.user.display_name)}</a>`
          : `<a class="btn primary" href="#/signup">Sign up free</a>
             <a class="btn ghost" href="#/login">Log in</a>`}
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
      grid.innerHTML = `<div class="card"><p class="lede" style="margin:0">No tracks yet. <a href="#/signup">Be the first artist</a>.</p></div>`;
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

// ─── Login ─────────────────────────────────────────────────
async function renderLogin() {
  const app = $('#app');
  app.innerHTML = `
    <h1>Log in</h1>
    <p class="lede">Welcome back. Enter your email and password.</p>
    <form id="loginForm" style="max-width:420px">
      <label>Email</label>
      <input type="email" id="loginEmail" required placeholder="you@example.com" />
      <label>Password</label>
      <input type="password" id="loginPassword" required minlength="8" placeholder="••••••••" />
      <div class="row" style="margin-top:18px">
        <button type="submit" class="btn primary">Log in</button>
        <a href="#/signup" class="btn ghost">Need an account?</a>
      </div>
    </form>
  `;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      session.user = data.user;
      session.wallet = data.wallet;
      toast('Welcome back.', 'good');
      location.hash = '#/';
      router();
    } catch (err) {
      toast(err.message);
    }
  });
}

// ─── Signup ────────────────────────────────────────────────
async function renderSignup() {
  const app = $('#app');
  app.innerHTML = `
    <h1>Create your account</h1>
    <p class="lede">Sign up with email + password. We'll create a Circle wallet on Arc Testnet for you in the background — you'll set a PIN to secure it.</p>
    <form id="signupForm" style="max-width:480px">
      <label>Email</label>
      <input type="email" id="su_email" required placeholder="you@example.com" />
      <label>Password (min 8 chars)</label>
      <input type="password" id="su_password" required minlength="8" placeholder="••••••••" />
      <label>Display name</label>
      <input type="text" id="su_name" required maxlength="60" placeholder="Your artist or fan name" />
      <label>I am a…</label>
      <select id="su_role" style="width:100%;padding:12px 14px;background:var(--bg-elev);border:1px solid var(--border);border-radius:10px;color:var(--fg);font:inherit">
        <option value="fan">Listener (just want to play tracks)</option>
        <option value="artist">Artist (I want to upload tracks and earn USDC)</option>
      </select>
      <label id="bioLabel" style="display:none">Artist bio (optional)</label>
      <textarea id="su_bio" rows="3" style="display:none" maxlength="500" placeholder="One line about you and your sound"></textarea>
      <div class="row" style="margin-top:18px">
        <button type="submit" class="btn primary">Create account</button>
        <a href="#/login" class="btn ghost">Already have an account?</a>
      </div>
    </form>
  `;
  $('#su_role').addEventListener('change', (e) => {
    const isArtist = e.target.value === 'artist';
    $('#bioLabel').style.display = isArtist ? '' : 'none';
    $('#su_bio').style.display = isArtist ? '' : 'none';
  });
  $('#signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#su_email').value.trim();
    const password = $('#su_password').value;
    const displayName = $('#su_name').value.trim();
    const role = $('#su_role').value;
    const bio = $('#su_bio').value.trim();
    if (!email || !password || !displayName) return toast('All fields required.');
    try {
      const data = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName, role, bio: bio || undefined }),
      });
      session.user = data.user;
      session.wallet = data.wallet;
      session.userToken = data.userToken;
      session.encryptionKey = data.encryptionKey;

      if (data.challengeId && APP_ID) {
        // Trigger Circle SDK to set up PIN
        toast('Setting up your wallet PIN…');
        const ok = await runCircleChallenge(data.challengeId, data.userToken, data.encryptionKey);
        if (ok) {
          await api('/api/auth/complete-pin-setup', { method: 'POST' });
          session.wallet = { ...session.wallet, pinSetupComplete: true };
          toast('Wallet ready!', 'good');
        } else {
          toast('PIN setup skipped — you can set it later from your dashboard.');
        }
      } else if (data.wallet) {
        toast('Account created.', 'good');
      } else {
        toast('Account created, but Circle wallet provisioning failed. Try again from your dashboard.', '');
      }
      location.hash = '#/';
      router();
    } catch (err) {
      toast(err.message);
    }
  });
}

// Run a Circle challenge via Web SDK. Used for both wallet creation (PIN setup)
// and per-play signing (EIP-712 typed data).
async function runCircleChallenge(challengeId, userToken, encryptionKey) {
  const sdk = await loadCircleSdk();
  if (!sdk) {
    console.warn('Circle SDK not loaded — running without PIN setup');
    return false;
  }
  if (userToken && encryptionKey) {
    sdk.setAuthentication({ userToken, encryptionKey });
  }
  return new Promise((resolve) => {
    sdk.execute(challengeId, (err, result) => {
      if (err) { console.error('sdk.execute error', err); resolve(false); return; }
      resolve(true);
    });
  });
}

// ─── Logout ────────────────────────────────────────────────
async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  session.user = null;
  session.wallet = null;
  session.userToken = null;
  session.encryptionKey = null;
  toast('Logged out.', 'good');
  location.hash = '#/';
  router();
}

// ─── Play flow ─────────────────────────────────────────────
async function startPlayFlow(trackId) {
  if (!session.user) {
    location.hash = '#/login';
    return;
  }
  try {
    const start = await api('/api/play/start', { method: 'POST', body: JSON.stringify({ trackId }) });

    showPlayerBar(start.track, start.artist, start.skip);

    const audio = $('#player');
    audio.src = start.track.audio_url;
    try { await audio.play(); } catch {}

    session.nowPlaying = {
      trackId,
      title: start.track.title,
      artistName: start.artist.display_name,
      audioUrl: start.track.audio_url,
      startedAt: Date.now(),
      settled: false,
    };
    session._challenge = start.challenge;

    if (start.skip) {
      toast(`Free play (${start.reason === 'replay_cooldown' ? 'replay cooldown' : 'skip-gated'})`, 'good');
      return;
    }

    toast(`Listening — sign in your wallet to pay $${start.challenge.valueUsdc} when you finish.`);
  } catch (e) {
    toast(`Play failed: ${e.message}`);
  }
}

function wirePlayer() {
  const audio = $('#player');
  if (!audio) return;
  audio.addEventListener('ended', () => confirmIfListening(Math.max(Math.floor(audio.currentTime), 1)));
  audio.addEventListener('pause', () => {
    const listened = Math.floor(audio.currentTime);
    if (listened > 0) confirmIfListening(listened);
  });
}

async function confirmIfListening(listenedSeconds) {
  if (!session.nowPlaying || session.nowPlaying.settled) return;
  session.nowPlaying.settled = true;
  const trackId = session.nowPlaying.trackId;
  const challenge = session._challenge;
  const wasSkipped = listenedSeconds < 10;
  let auth = null;

  if (!wasSkipped && challenge) {
    try {
      auth = await signWithCircle(challenge);
    } catch (e) {
      console.warn('sign failed', e);
      toast(`Signing failed: ${e.message}. Play recorded as free.`);
    }
  }

  try {
    const res = await api('/api/play/confirm', {
      method: 'POST',
      body: JSON.stringify({ trackId, listenedSeconds, auth: auth || undefined }),
    });
    if (res.skipped) {
      toast(`Skipped (${listenedSeconds}s) — no charge`, 'good');
    } else if (res.ok) {
      toast(`✓ Paid $${res.charged} to ${session.nowPlaying.artistName} · settlement ${res.settlementId.slice(0, 8)}…`, 'good');
      pollSettlement(res.settlementId);
    } else {
      toast(`Payment failed: ${res.failReason}`, '');
    }
  } catch (e) {
    toast(`Confirm failed: ${e.message}`);
  }
}

// Sign the x402 challenge via Circle SDK.
// Returns a fresh signed X402Auth payload, or null if the user skipped.
async function signWithCircle(challenge) {
  const sdk = await loadCircleSdk();
  if (!sdk) throw new Error('Circle SDK not loaded');

  // Get/refresh userToken (60 min expiry)
  let { userToken, encryptionKey } = session;
  if (!userToken) {
    const t = await api('/api/auth/refresh-circle-token', { method: 'POST' });
    userToken = t.userToken;
    encryptionKey = t.encryptionKey;
    session.userToken = userToken;
    session.encryptionKey = encryptionKey;
  }

  sdk.setAuthentication({ userToken, encryptionKey });

  // Ask backend to create a sign challenge for this typed data.
  const r = await fetch(API + '/api/play/sign-challenge', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge, userId: session.user.email }),
  });
  if (!r.ok) throw new Error('sign-challenge failed: ' + r.status);
  const { challengeId } = await r.json();
  if (!challengeId) return null;

  return new Promise((resolve, reject) => {
    sdk.execute(challengeId, (err, result) => {
      if (err) return reject(err);
      const signature = result?.data?.signature?.signature ?? result?.signature;
      if (!signature) return reject(new Error('no signature in SDK result'));
      resolve({
        payer: challenge.payer,        // backend will resolve to wallet address
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
        <span class="stat">wallet <strong>${(artist.wallet_address || '').slice(0,8)}…</strong></span>
      </div>
      <h2>Tracks</h2>
      <div class="grid">${tracks.length === 0 ? '<div class="card">No tracks yet.</div>' : tracks.map(trackCard).join('')}</div>
    `;
    wireTrackCards();
  } catch (e) { app.innerHTML = `<div class="card">Couldn't load: ${e.message}</div>`; }
}

// ─── Dashboard ─────────────────────────────────────────────
async function renderDashboard() {
  if (!session.user) { location.hash = '#/login'; return; }
  const app = $('#app');
  try {
    const d = await api('/api/dashboard');
    app.innerHTML = `
      <h1>${escapeHtml(d.artist.display_name)} — dashboard</h1>
      <div class="row" style="gap:12px;margin-bottom:24px;flex-wrap:wrap">
        <span class="stat"><strong>${d.totals.plays}</strong> plays</span>
        <span class="stat"><strong>$${d.totals.earningsUsdc}</strong> USDC earned</span>
        <span class="stat">${d.tracks.length} tracks</span>
        <span class="stat">wallet <strong>${(d.wallet?.address || '').slice(0,10)}…</strong></span>
        ${!session.wallet?.pinSetupComplete ? '<span class="stat" style="border-color:#ff6b35;color:#ff6b35"><strong>Set wallet PIN</strong></span>' : ''}
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
            </tr>`).join('') || '<tr><td colspan="5" style="color:var(--fg-mute)">No tracks yet.</td></tr>'}
        </tbody>
      </table>

      <h2 style="margin-top:32px">Upload a new track</h2>
      <div style="max-width:480px">
        <label>Title</label><input type="text" id="up_title" />
        <label>Audio URL</label><input type="text" id="up_audio" placeholder="https://... or /audio/demo.mp3" />
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
                <td>${(p.fan_wallet_address || '').slice(0,10)}…</td>
                <td>$${p.charged_usdc}</td>
                <td class="txhash">${(p.settlement_id || '').slice(0,14)}…</td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    `;
    wireTrackCards();
    $('#up_submit').onclick = async () => {
      const body = {
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
      <li>Fan signs up with email + password → Circle W3S provisions a real wallet on Arc Testnet.</li>
      <li>Fan funds the wallet at <a href="https://faucet.circle.com" target="_blank">faucet.circle.com</a> (Circle ships testnet USDC).</li>
      <li>Fan hits play → backend issues an x402 EIP-712 challenge.</li>
      <li>Wallet signs the typed data → backend verifies → submits to Circle Gateway facilitator.</li>
      <li>Relayer batches many settlements → one on-chain <code>submitBatch</code> tx on Arc → payment final in &lt;500ms.</li>
    </ol>
    <h2>Skip-gating</h2>
    <ul style="color:var(--fg-mute);max-width:60ch">
      <li>Listen &lt; 10 seconds → free, no signature</li>
      <li>Replay within 30 seconds → free</li>
      <li>Full listen → signature required, settles on Arc</li>
    </ul>
    ${stats ? `<h2>Live stats</h2>
      <div class="row" style="gap:12px;flex-wrap:wrap">
        <span class="stat"><strong>${stats.users}</strong> users</span>
        <span class="stat"><strong>${stats.artists}</strong> artists</span>
        <span class="stat"><strong>${stats.tracks}</strong> tracks</span>
        <span class="stat"><strong>${stats.plays}</strong> plays (${stats.settledPlays} settled)</span>
        <span class="stat"><strong>$${Number(stats.totalUsdc).toFixed(6)}</strong> USDC</span>
        <span class="stat">${stats.network}</span>
      </div>` : ''}
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

window.addEventListener('DOMContentLoaded', () => { router(); wirePlayer(); });