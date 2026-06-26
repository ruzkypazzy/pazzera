// Pazzera web app — vanilla JS, no framework.
// Hash-based router, single audio element, embedded wallet flow via email.

const API = window.PAZZERA_API ?? 'http://localhost:3001';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Simple session: email-keyed fan wallet + optional artist session
const session = {
  fanEmail: localStorage.getItem('pazzera_fan_email') || null,
  fanWallet: JSON.parse(localStorage.getItem('pazzera_fan_wallet') || 'null'),
  artistId: localStorage.getItem('pazzera_artist_id') || null,
  artistName: localStorage.getItem('pazzera_artist_name') || null,
  nowPlaying: null, // { trackId, title, artistName, audioUrl, startedAt, settled }
};

function saveSession() {
  localStorage.setItem('pazzera_fan_email', session.fanEmail ?? '');
  localStorage.setItem('pazzera_fan_wallet', JSON.stringify(session.fanWallet ?? null));
  localStorage.setItem('pazzera_artist_id', session.artistId ?? '');
  localStorage.setItem('pazzera_artist_name', session.artistName ?? '');
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
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

// ─── Router ──────────────────────────────────────────────
const routes = {
  '/': renderBrowse,
  '/artist/signup': renderArtistSignup,
  '/artist/:id': renderArtist,
  '/dashboard': renderDashboard,
  '/about': renderAbout,
};

function parseRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  // Match static first, then parameterized
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

// ─── Browse view ─────────────────────────────────────────
async function renderBrowse() {
  const app = $('#app');
  app.innerHTML = `
    <section class="hero">
      <h1>Pay per listen.</h1>
      <p class="lede">Independent artists upload a track, set a price per play, and earn USDC on Arc the moment you hit play. No subscription, no platform cut.</p>
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
      grid.innerHTML = `<div class="card"><p class="lede" style="margin:0">No tracks yet. Be the first — <a href="#/artist/signup">upload yours</a>.</p></div>`;
      return;
    }
    grid.innerHTML = tracks.map(trackCard).join('');
    wireTrackCards();
  } catch (e) {
    $('#catalog').innerHTML = `<div class="card">Couldn't load tracks: ${e.message}</div>`;
  }
}

function trackCard(t) {
  const cover = t.cover_url
    ? `<div class="cover"><img src="${escapeHtml(t.cover_url)}" alt=""></div>`
    : `<div class="cover">♪</div>`;
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
  $$('[data-play]').forEach(btn => {
    btn.addEventListener('click', () => startPlayFlow(btn.dataset.play));
  });
}

// ─── Play flow ───────────────────────────────────────────
async function startPlayFlow(trackId) {
  // 1. Need fan email → modal
  if (!session.fanEmail) {
    const email = await promptEmail();
    if (!email) return;
    await signupFan(email);
  }

  // 2. POST /api/play/start → get x402 challenge (or skip=true)
  const start = await api('/api/play/start', {
    method: 'POST',
    body: JSON.stringify({ trackId, fanEmail: session.fanEmail }),
  });

  showPlayerBar(start.track, start.artist, start.skip);

  if (start.skip) {
    toast(`Free play (${start.reason === 'replay_cooldown' ? 'replay cooldown' : 'skip-gated'})`, 'good');
  } else {
    toast(`Play authorized — will settle $${start.challenge.amount} when you finish listening.`);
  }

  // 3. Wire the audio element
  const audio = $('#player');
  audio.src = start.track.audio_url;
  session.nowPlaying = {
    trackId,
    title: start.track.title,
    artistName: start.artist.display_name,
    audioUrl: start.track.audio_url,
    startedAt: Date.now(),
    settled: false,
  };
  session._challenge = start.challenge; // held for confirm step

  try { await audio.play(); } catch (e) { /* autoplay blocked — user must click again */ }
}

function wirePlayer() {
const audio = $('#player');
if (!audio) return;
audio.addEventListener('timeupdate', () => {
  if (!session.nowPlaying) return;
  const elapsed = Math.floor(audio.currentTime);
  if (elapsed >= 10 && !session._tickLogged) {
    session._tickLogged = true;
    // optional: visual heartbeat
  }
});

audio.addEventListener('ended', async () => {
  if (!session.nowPlaying || session.nowPlaying.settled) return;
  const listened = Math.floor(audio.currentTime || (Date.now() - session.nowPlaying.startedAt) / 1000);
  await confirmPlay(listened);
});

audio.addEventListener('pause', async () => {
  if (!session.nowPlaying || session.nowPlaying.settled) return;
  // user paused mid-listen — settle based on what was heard
  const listened = Math.floor(audio.currentTime);
  if (listened > 0) await confirmPlay(listened);
});
}

async function confirmPlay(listenedSeconds) {
  if (session.nowPlaying.settled) return;
  const trackId = session.nowPlaying.trackId;
  const challenge = session._challenge;
  const skip = listenedSeconds < 10;

  // Build x402 auth — in real life the embedded wallet signs EIP-3009.
  // For the hackathon demo we build a well-formed auth object.
  const auth = challenge && !skip ? {
    payerAddress: session.fanWallet.address,
    payeeAddress: challenge.payee,
    amountUsdc: challenge.amount,
    resourceId: challenge.resource,
    nonce: challenge.nonce,
    validUntil: Date.now() + 60_000,
    signature: '0x' + Array.from(challenge.nonce).map(c => c.charCodeAt(0).toString(16)).join('').padEnd(130, '0'),
  } : null;

  try {
    const res = await api('/api/play/confirm', {
      method: 'POST',
      body: JSON.stringify({
        trackId,
        fanEmail: session.fanEmail,
        listenedSeconds,
        auth,
      }),
    });
    session.nowPlaying.settled = true;
    if (res.skipped) {
      toast(`Skipped (${listenedSeconds}s) — no charge`, 'good');
    } else {
      toast(`✓ Settled $${res.charged} to ${session.nowPlaying.artistName} · tx ${res.txHash.slice(0, 10)}…`, 'good');
    }
  } catch (e) {
    toast(`Settlement failed: ${e.message}`);
  }
}

function showPlayerBar(track, artist, skip) {
  const bar = document.createElement('div');
  bar.id = 'playerBar';
  bar.className = 'player-bar visible';
  const cover = track.cover_url ? `<img src="${escapeHtml(track.cover_url)}" style="width:100%;height:100%;object-fit:cover">` : '♪';
  bar.innerHTML = `
    <div class="cover">${cover}</div>
    <div class="info">
      <div class="title">${escapeHtml(track.title)}</div>
      <div class="meta">${escapeHtml(artist.display_name)} · $${track.price_per_listen_usdc}/listen${skip ? ' · free skip' : ''}</div>
    </div>
  `;
  document.body.appendChild(bar);
}

function hidePlayerBar() {
  $('#playerBar')?.remove();
}

// ─── Fan signup modal ────────────────────────────────────
function promptEmail() {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal">
        <h2>One step to listen</h2>
        <p class="lede">Enter your email. We create a tiny wallet for you, pre-funded with testnet USDC. No seed phrase, no MetaMask.</p>
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
    back.addEventListener('click', (e) => { if (e.target === back) close(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value.trim() || null); });
  });
}

async function signupFan(email) {
  const res = await api('/api/play/signup', { method: 'POST', body: JSON.stringify({ email }) });
  session.fanEmail = email;
  session.fanWallet = res.wallet;
  saveSession();
  toast(`Wallet ${res.wallet.address.slice(0, 10)}… funded with $${res.fundedUsdc} USDC`, 'good');
}

// ─── Artist signup ───────────────────────────────────────
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
      <textarea id="su_bio" rows="3" placeholder="One line about you and your sound"></textarea>
      <div class="row" style="margin-top:18px">
        <button class="btn primary" id="su_submit">Create artist account</button>
      </div>
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
      location.hash = `#/dashboard`;
      toast('Artist account created.', 'good');
    } catch (e) {
      toast(`Signup failed: ${e.message}`);
    }
  };
}

// ─── Artist page ─────────────────────────────────────────
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
      <div class="grid">
        ${tracks.length === 0 ? '<div class="card">No tracks yet.</div>' : tracks.map(trackCard).join('')}
      </div>
    `;
    wireTrackCards();
  } catch (e) {
    app.innerHTML = `<div class="card">Couldn't load artist: ${e.message}</div>`;
  }
}

// ─── Artist dashboard ────────────────────────────────────
async function renderDashboard() {
  const app = $('#app');
  if (!session.artistId) {
    app.innerHTML = `
      <h1>Dashboard</h1>
      <p class="lede">Sign up as an artist first.</p>
      <a class="btn primary" href="#/artist/signup">Become an artist</a>
    `;
    return;
  }
  try {
    const d = await api(`/api/dashboard/${session.artistId}`);
    app.innerHTML = `
      <h1>${escapeHtml(d.artist.display_name)} — dashboard</h1>
      <div class="row" style="gap:12px;margin-bottom:24px">
        <span class="stat"><strong>${d.totals.plays}</strong> total plays</span>
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
            </tr>
          `).join('')}
        </tbody>
      </table>

      <h2 style="margin-top:32px">Upload a new track</h2>
      <div style="max-width:480px">
        <label>Title</label>
        <input type="text" id="up_title" />
        <label>Audio URL</label>
        <input type="text" id="up_audio" placeholder="https://... or /tracks/your.mp3" />
        <label>Cover URL (optional)</label>
        <input type="text" id="up_cover" />
        <label>Duration (seconds)</label>
        <input type="text" id="up_duration" />
        <label>Price per listen (USDC)</label>
        <input type="text" id="up_price" value="0.001" />
        <div class="row" style="margin-top:14px">
          <button class="btn primary" id="up_submit">Upload track</button>
        </div>
      </div>

      <h2 style="margin-top:32px">Recent settled plays</h2>
      ${d.recentPlays.length === 0 ? '<p class="lede">No plays yet.</p>' : `
        <table>
          <thead><tr><th>When</th><th>Track</th><th>Fan</th><th>Amount</th><th>Tx</th></tr></thead>
          <tbody>
            ${d.recentPlays.map(p => `
              <tr>
                <td>${new Date(p.created_at).toLocaleString()}</td>
                <td>${escapeHtml(p.track_title)}</td>
                <td>${p.fan_wallet_address.slice(0,10)}…</td>
                <td>$${p.charged_usdc}</td>
                <td class="txhash">${(p.settlement_tx_hash || '').slice(0,14)}…</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
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
      if (!body.title || !body.audioUrl || !body.durationSeconds) return toast('Title, audio URL, and duration required.');
      try {
        await api('/api/tracks', { method: 'POST', body: JSON.stringify(body) });
        toast('Track uploaded.', 'good');
        router();
      } catch (e) { toast(`Upload failed: ${e.message}`); }
    };
  } catch (e) {
    app.innerHTML = `<div class="card">Couldn't load dashboard: ${e.message}</div>`;
  }
}

// ─── About ───────────────────────────────────────────────
async function renderAbout() {
  const app = $('#app');
  let stats;
  try { stats = await api('/api/admin/stats'); } catch { stats = null; }
  app.innerHTML = `
    <h1>How Pazzera works</h1>
    <p class="lede">Every play moves a fraction of a USDC cent from the fan's wallet to the artist — settled on Arc in under 500ms.</p>

    <h2>The flow</h2>
    <ol style="color:var(--fg-mute);max-width:60ch">
      <li>Fan enters email → embedded Circle wallet created, pre-funded with testnet USDC from Canteen faucet.</li>
      <li>Fan hits play → backend issues an <strong>x402 challenge</strong> (HTTP 402 Payment Required).</li>
      <li>Fan listens for at least 10 seconds → EIP-3009 authorization signed, payment settles via <strong>Circle Gateway</strong> on Arc.</li>
      <li>Skip in the first 10 seconds, or replay within 30 seconds → free.</li>
      <li>Artist sees plays and earnings in real time on their dashboard.</li>
    </ol>

    <h2>The stack</h2>
    <ul style="color:var(--fg-mute);max-width:60ch">
      <li><strong>Wallets</strong>: Circle Developer-Controlled Wallets (embedded, email-keyed)</li>
      <li><strong>Payment rail</strong>: x402 + Circle Gateway → USDC on Arc, sub-second finality</li>
      <li><strong>Skip-gating</strong>: agent decides when to charge vs when to free-play</li>
      <li><strong>Multi-artist</strong>: any artist can sign up, set price, onboard fans</li>
    </ul>

    ${stats ? `
      <h2>Live stats (testnet)</h2>
      <div class="row" style="gap:12px;flex-wrap:wrap">
        <span class="stat"><strong>${stats.artists}</strong> artists</span>
        <span class="stat"><strong>${stats.tracks}</strong> tracks</span>
        <span class="stat"><strong>${stats.plays}</strong> plays (${stats.settledPlays} settled)</span>
        <span class="stat"><strong>$${Number(stats.totalUsdc).toFixed(6)}</strong> USDC settled</span>
      </div>
    ` : ''}
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Wire audio events after DOM ready
window.addEventListener('DOMContentLoaded', () => {
  router();
  wirePlayer();
});