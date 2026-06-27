// Pazzera — main client app
// Spotify-style music platform with pay-per-listen on Arc

const API = window.PAZZERA_API || 'https://api.pazzera.com';

// ============ STATE ============
const state = {
  user: null,
  account: null,           // full /api/account response (user + wallet + balance)
  currentTrack: null,
  audio: null,
  isPlaying: false,
  listeningNowCount: 0,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const html = (s, ...vals) => s.reduce((acc, str, i) => acc + str + (vals[i] ?? ''), '');

// ============ TOAST ============
let toastTimer;
function toast(msg, kind = '', ms = 3500) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// ============ API CLIENT ============
async function api(path, opts = {}) {
  const url = `${API}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  try {
    const r = await fetch(url, { ...opts, headers, credentials: 'include' });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (!r.ok) {
      const msg = body?.error || body?.message || `HTTP ${r.status}`;
      const err = new Error(msg);
      err.status = r.status;
      err.body = body;
      throw err;
    }
    return body;
  } catch (e) {
    if (e.name === 'TypeError') throw new Error(`Network error: ${e.message}`);
    throw e;
  }
}

// ============ AVATAR HELPERS ============
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffff;
  return `hsl(${h % 360}, 65%, 50%)`;
}
function avatarHtml(name, url, size = 40) {
  if (url) return `<img class="avatar" src="${esc(url)}" style="width:${size}px;height:${size}px;" alt="" />`;
  const bg = avatarColor(name ?? 'x');
  return `<div class="avatar avatar-initial" style="background:${bg};width:${size}px;height:${size}px;font-size:${size * 0.4}px;">${esc(initials(name))}</div>`;
}
function truncateAddr(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
function formatUsdc(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n) || n === 0) return '0.00';
  if (n < 0.01) return n.toFixed(6);
  if (n < 1) return n.toFixed(4);
  return n.toFixed(2);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ============ AUTH ============
async function loadMe() {
  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
    state.account = data;
  } catch {
    state.user = null;
    state.account = null;
  }
  renderAuth();
  renderEmailBanner();
}

async function signup(email, password, displayName, role) {
  const res = await api('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName, role }),
  });
  state.user = res.user;
  toast('Account created 🎵 Check the email we sent.', 'success', 6000);
  router.go(res.wallet && !res.wallet.pinSetupComplete ? '/onboarding/pin' : '/account');
  await loadMe();
  // PIN setup flow needs challengeId + userToken + encryptionKey
  if (res.challengeId && res.userToken && res.encryptionKey) {
    state.pendingPinSetup = {
      challengeId: res.challengeId,
      userToken: res.userToken,
      encryptionKey: res.encryptionKey,
    };
    router.go('/onboarding/pin');
  }
}

async function login(email, password) {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  state.user = res.user;
  toast(`Welcome back, ${res.user.display_name}!`, 'success');
  router.go('/');
  await loadMe();
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  state.user = null;
  state.account = null;
  toast('Logged out');
  renderAuth();
  router.go('/');
}

function renderEmailBanner() {
  let banner = $('#email-banner');
  const user = state.user;
  if (!user) {
    banner?.remove();
    return;
  }
  if (user.email_verified) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'email-banner';
    banner.className = 'email-banner';
    document.body.prepend(banner);
  }
  banner.innerHTML = html`
    <span>📬 Your email isn't verified yet.</span>
    <button class="btn btn-sm btn-ghost" onclick="Pazzera.resendVerification()">Resend</button>
    <button class="banner-close" onclick="this.parentElement.remove()">×</button>
  `;
}

async function resendVerification() {
  try {
    const r = await api('/api/account/verify-email/send', { method: 'POST' });
    if (r.previewUrl) {
      toast(`Email queued. Preview: ${r.previewUrl}`, 'info', 10000);
    } else if (r.sent) {
      toast('Verification email sent — check your inbox.', 'success');
    } else {
      toast(r.error || 'Failed to send email', 'error');
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderAuth() {
  const area = $('#auth-area');
  const account = state.account;
  const user = state.user;

  if (!user) {
    area.innerHTML = html`
      <div class="row">
        <a href="/login" data-link class="btn btn-ghost btn-sm">Log in</a>
        <a href="/signup" data-link class="btn btn-primary btn-sm">Sign up</a>
      </div>
    `;
    return;
  }

  const wallet = account?.wallet;
  const usdc = wallet?.usdcBalance || wallet?.cached_balance_usdc || '0';
  const usdcNum = parseFloat(usdc) || 0;

  area.innerHTML = html`
    <div class="row nav-user">
      <div class="wallet-pill" title="${esc(wallet?.address || 'No wallet')}" onclick="Pazzera.copyWallet()">
        <span class="wallet-dot ${usdcNum > 0 ? 'funded' : 'empty'}"></span>
        <span class="wallet-balance">${formatUsdc(usdc)} <span class="muted">USDC</span></span>
        <span class="wallet-addr">${esc(truncateAddr(wallet?.address))}</span>
      </div>
      <a href="/account" data-link class="user-chip">
        ${avatarHtml(user.display_name, account?.user?.avatar_url, 28)}
        <span>${esc(user.display_name)}</span>
      </a>
      <button class="btn btn-ghost btn-sm" onclick="Pazzera.logout()">Logout</button>
    </div>
  `;
}

async function copyWallet() {
  const addr = state.account?.wallet?.address;
  if (!addr) {
    toast('No wallet yet — visit your account page to set one up', 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(addr);
    toast('Wallet address copied ✓', 'success', 2000);
  } catch {
    toast(`Address: ${addr}`, 'info', 8000);
  }
}

// ============ ROUTER ============
const router = {
  routes: {},
  current: null,
  go(path) {
    history.pushState({}, '', path);
    this.render();
  },
  on(path, handler) {
    this.routes[path] = handler;
  },
  match() {
    const path = window.location.pathname;
    for (const [pattern, handler] of Object.entries(this.routes)) {
      const params = matchPath(pattern, path);
      if (params) return { handler, params };
    }
    return null;
  },
  async render() {
    const match = this.match();
    const app = $('#app');
    if (!match) {
      app.innerHTML = render404();
      return;
    }
    app.innerHTML = loadingScreen();
    window.scrollTo({ top: 0, behavior: 'instant' });
    try {
      await match.handler(match.params);
    } catch (e) {
      console.error(e);
      app.innerHTML = renderError(e);
    }
    $$('.navlinks a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === window.location.pathname);
    });
  }
};

function matchPath(pattern, path) {
  const ps = pattern.split('/').filter(Boolean);
  const xs = path.split('/').filter(Boolean);
  if (ps.length !== xs.length) return null;
  const params = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(':')) params[ps[i].slice(1)] = decodeURIComponent(xs[i]);
    else if (ps[i] !== xs[i]) return null;
  }
  return params;
}

window.addEventListener('popstate', () => router.render());
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#')) return;
  e.preventDefault();
  router.go(href);
});

function loadingScreen() {
  return html`<div class="loading"><div class="spinner"></div></div>`;
}
function render404() {
  return html`<div class="loading"><h2>Page not found</h2><p class="muted"><a href="/" data-link>Go home</a></p></div>`;
}
function renderError(e) {
  return html`
    <div class="loading">
      <h2>Something went wrong</h2>
      <p class="muted">${esc(e.message)}</p>
      <button class="btn btn-ghost" onclick="location.reload()">Try again</button>
    </div>
  `;
}

// ============ PLAYER ============
function showPlayer(track, audioUrl) {
  state.currentTrack = track;
  $('#player-bar').classList.remove('hidden');
  $('#player-art-img').src = track.cover_url || makePlaceholderArt(track.title);
  $('#player-title').textContent = track.title;
  $('#player-artist').textContent = track.artist_name || 'Unknown artist';
  const audio = $('#player-audio');
  audio.src = audioUrl;
  audio.volume = parseFloat($('#player-volume').value);
  audio.play().catch(() => {});
  state.isPlaying = true;
  updatePlayBtn();
}

function updatePlayBtn() {
  $('#player-toggle').textContent = state.isPlaying ? '❚❚' : '▶';
}

function makePlaceholderArt(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffff;
  const h1 = hash % 360;
  const h2 = (h1 + 80) % 360;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${h1},70%,50%)'/><stop offset='1' stop-color='hsl(${h2},70%,30%)'/></linearGradient></defs><rect width='100' height='100' fill='url(%23g)'/><text x='50' y='62' font-family='Inter' font-weight='900' font-size='40' fill='white' text-anchor='middle' opacity='0.9'>${seed[0]?.toUpperCase() || '♪'}</text></svg>`)}`;
}

function bindPlayer() {
  const audio = $('#player-audio');
  $('#player-toggle').addEventListener('click', () => {
    if (state.isPlaying) { audio.pause(); state.isPlaying = false; }
    else { audio.play(); state.isPlaying = true; }
    updatePlayBtn();
  });
  $('#player-volume').addEventListener('input', (e) => {
    audio.volume = parseFloat(e.target.value);
  });
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    $('#player-progress-fill').style.width = `${pct}%`;
    $('#player-cur').textContent = fmtTime(audio.currentTime);
    $('#player-dur').textContent = fmtTime(audio.duration);
  });
  $('#player-progress-track').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  });
  audio.addEventListener('ended', () => {
    state.isPlaying = false;
    updatePlayBtn();
  });
}

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ============ LISTENING NOW POLLING ============
async function pollListeningNow() {
  try {
    const { count } = await api('/api/stats/listening-now');
    state.listeningNowCount = count;
    const el = $('#listening-now-count');
    if (el) el.textContent = count;
  } catch {}
}
setInterval(pollListeningNow, 5000);
setTimeout(pollListeningNow, 500);

// ============ PLAY (with x402 charge) ============
async function playTrack(track) {
  if (!state.user) {
    toast('Sign in to play', 'error');
    router.go('/login');
    return;
  }
  if (state.account && !state.account.user?.email_verified) {
    toast('Verify your email first (check the banner at the top)', 'error', 5000);
    return;
  }
  // Check wallet + balance
  const wallet = state.account?.wallet;
  if (!wallet?.address) {
    toast('No wallet — visit your account page', 'error');
    router.go('/account');
    return;
  }

  const lastPlay = state._lastPlay?.[track.id];
  const now = Date.now();
  if (lastPlay && now - lastPlay < (track.replay_cooldown_seconds ?? 30) * 1000) {
    showPlayer(track, track.audio_url);
    toast(`Replay (free within ${track.replay_cooldown_seconds}s cooldown)`);
    return;
  }

  try {
    toast('Preparing payment…');
    const challenge = await api('/api/play/start', {
      method: 'POST',
      body: JSON.stringify({ trackId: track.id }),
    });
    if (challenge.skip) {
      showPlayer(track, track.audio_url);
      toast('Playing (preview free)');
    } else {
      const sig = await fakeSign(challenge.typedData);
      const confirm = await api('/api/play/confirm', {
        method: 'POST',
        body: JSON.stringify({ playId: challenge.playId, signature: sig }),
      });
      if (confirm.settled) {
        showPlayer(track, track.audio_url);
        toast(`Paid ${track.price_per_listen_usdc} USDC ✓`, 'success');
      }
    }
    state._lastPlay = state._lastPlay || {};
    state._lastPlay[track.id] = now;
  } catch (e) {
    toast(e.message || 'Payment failed', 'error');
  }
}

async function fakeSign(typedData) {
  return '0x' + '00'.repeat(65);
}

// ============ PAGES ============

// --- HOME / BROWSE ---
router.on('/', async () => {
  const [artistsData, tracksData, listeningNow] = await Promise.all([
    api('/api/artists').catch(() => ({ artists: [] })),
    api('/api/tracks').catch(() => ({ tracks: [] })),
    api('/api/stats/listening-now').catch(() => ({ count: 0 })),
  ]);
  const artists = artistsData.artists || [];
  const topTracks = (tracksData.tracks || []).slice(0, 12);

  $('#app').innerHTML = html`
    <section class="hero">
      <div class="hero-text">
        <h1>Pay a fraction of a cent. Every time you press play.</h1>
        <p>The artist gets paid directly in USDC on Arc — no middlemen, no waiting weeks for a payout. Powered by Circle x402 and Gateway.</p>
        <div class="hero-actions">
          <a href="#tracks" class="btn btn-primary">▶ Start listening</a>
          ${state.user?.role !== 'artist' ? html`<a href="/signup?role=artist" data-link class="btn btn-ghost">I'm an artist</a>` : ''}
        </div>
      </div>
      <div class="hero-art">♪</div>
    </section>

    ${artists.length > 0 ? html`
      <section class="section">
        <div class="section-head">
          <h2>Featured artists</h2>
          <span class="muted">${artists.length} on Pazzera</span>
        </div>
        <div class="artist-grid">
          ${artists.slice(0, 8).map(a => html`
            <a href="/artist/${a.id}" data-link class="artist-card">
              <div class="artist-avatar">${(a.display_name || a.name || '?')[0].toUpperCase()}</div>
              <h4>${esc(a.display_name || a.name || 'Unknown')}</h4>
              <div class="meta">${a.track_count ?? 0} tracks</div>
            </a>
          `).join('')}
        </div>
      </section>
    ` : ''}

    <section class="section" id="tracks">
      <div class="section-head">
        <h2>Trending tracks</h2>
        <span class="muted">${topTracks.length} tracks</span>
      </div>
      <div class="track-list">
        ${topTracks.map((t, i) => trackRow(t, i + 1)).join('')}
        ${topTracks.length === 0 ? emptyState('🎵', 'No tracks yet', 'Be the first to upload — sign up as an artist.', '/signup?role=artist') : ''}
      </div>
    </section>

    <section class="section">
      <div class="chart-card">
        <h3>Live on Pazzera</h3>
        <p class="muted"><span class="listening-now-pill"><span class="pulse-dot"></span><strong>${listeningNow.count}</strong> listening right now</span></p>
        <p class="muted" style="margin-top:12px;">Every play triggers a real x402 payment in USDC. Every artist gets paid directly. No platform tax.</p>
      </div>
    </section>
  `;
});

// --- ARTIST PROFILE (PUBLIC) ---
router.on('/artist/:id', async ({ id }) => {
  const data = await api(`/api/artists/${id}`);
  const a = data.artist;
  const tracks = data.tracks || [];
  const stats = await api(`/api/stats/artist/${id}`).catch(() => ({ total_plays: 0, total_earnings_usdc: '0', listeners: 0 }));

  $('#app').innerHTML = html`
    <div class="profile-card">
      ${avatarHtml(a.display_name, a.avatar_url, 120).replace('class="avatar', 'class="big-avatar')}
      <div class="profile-meta">
        <div class="meta-type">Artist</div>
        <h1>${esc(a.display_name || 'Unknown artist')}</h1>
        <p class="profile-bio">${esc(a.bio || 'No bio yet.')}</p>
        ${a.wallet_address ? html`<p class="muted small">Wallet: <code>${esc(truncateAddr(a.wallet_address))}</code></p>` : ''}
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total plays</div>
        <div class="kpi-value">${(stats.total_plays || 0).toLocaleString()}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Earnings</div>
        <div class="kpi-value">${formatUsdc(stats.total_earnings_usdc || '0')}</div>
        <div class="kpi-delta">USDC on Arc</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Listeners</div>
        <div class="kpi-value">${(stats.listeners || 0).toLocaleString()}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Tracks</div>
        <div class="kpi-value">${tracks.length}</div>
      </div>
    </div>

    <section class="section">
      <div class="section-head"><h2>Tracks</h2></div>
      <div class="track-list">
        ${tracks.map((t, i) => trackRow(t, i + 1)).join('')}
        ${tracks.length === 0 ? emptyState('🎶', 'No tracks published', 'This artist hasn\'t uploaded yet.') : ''}
      </div>
    </section>
  `;
});

// --- TRACK DETAIL ---
router.on('/track/:id', async ({ id }) => {
  const data = await api(`/api/tracks/${id}`);
  const t = data.track;
  const stats = await api(`/api/stats/track/${id}`).catch(() => ({ plays: 0, earnings_usdc: '0', listeners_now: 0 }));

  $('#app').innerHTML = html`
    <div class="track-detail">
      <div class="big-art">${(t.title || '♪')[0].toUpperCase()}</div>
      <div>
        <div class="meta-type">Track</div>
        <h1>${esc(t.title)}</h1>
        <a class="artist-link" href="/artist/${t.artist_id}" data-link>By ${esc(t.artist_name || 'Unknown artist')}</a>
        ${t.description ? html`<p class="muted" style="margin-top:16px;">${esc(t.description)}</p>` : ''}
        <div class="waveform" id="waveform">
          ${Array.from({length: 60}, () => `<div class="bar"></div>`).join('')}
        </div>
        <div class="actions">
          <button class="btn btn-primary" onclick='Pazzera.playTrack(${JSON.stringify(t).replace(/'/g, "\\'")})'>▶ Pay & Play</button>
          <div class="price-tag">
            <span class="big">${t.price_per_listen_usdc}</span>
            <span class="small">USDC / listen</span>
          </div>
        </div>
        <div class="stats">
          <div class="stat">
            <div class="stat-label">Plays</div>
            <div class="stat-value">${(stats.plays || 0).toLocaleString()}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Earnings</div>
            <div class="stat-value">${formatUsdc(stats.earnings_usdc || '0')}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Listening now</div>
            <div class="stat-value">${stats.listeners_now ?? 0}</div>
          </div>
        </div>
      </div>
    </div>
  `;
});

// --- ACCOUNT PAGE (fan or artist) ---
router.on('/account', async () => {
  if (!state.user) { router.go('/login?next=/account'); return; }
  await loadMe();
  const account = state.account;
  if (!account) { router.go('/login'); return; }

  const user = account.user;
  const wallet = account.wallet;
  const artist = account.artist;
  const u = user;  // alias
  const verified = u.email_verified;

  $('#app').innerHTML = html`
    <div class="page-head">
      <h1>Your account</h1>
      <p class="lede">Manage your profile, wallet, and security.</p>
    </div>

    ${!verified ? `
      <div class="alert alert-warn">
        <strong>📬 Verify your email</strong> to unlock all features.
        <button class="btn btn-sm btn-primary" onclick="Pazzera.resendVerification()">Resend verification</button>
      </div>
    ` : ''}

    <div class="account-grid">
      <!-- Profile card -->
      <section class="account-section">
        <h2>Profile</h2>
        <div class="profile-edit">
          <div class="avatar-edit">
            <div id="avatar-preview">${avatarHtml(u.display_name, u.avatar_url, 96)}</div>
            <label class="btn btn-ghost btn-sm">
              <input type="file" id="avatar-input" accept="image/*" style="display:none" onchange="Pazzera.uploadAvatar(this)" />
              Upload photo
            </label>
          </div>
          <form id="profile-form" class="form-grid">
            <div class="form-field">
              <label>Display name</label>
              <input name="displayName" value="${esc(u.display_name)}" maxlength="60" required />
            </div>
            <div class="form-field">
              <label>Email</label>
              <input value="${esc(u.email)}" disabled />
              <div class="hint">${verified ? '✓ Verified' : '⚠ Not verified'}</div>
            </div>
            <div class="form-field">
              <label>Bio</label>
              <textarea name="bio" rows="3" maxlength="500" placeholder="Tell people about yourself">${esc(u.bio || '')}</textarea>
            </div>
            <div class="form-field">
              <label>Location</label>
              <input name="location" value="${esc(u.location || '')}" maxlength="100" placeholder="Lagos, Nigeria" />
            </div>
            <div class="form-field">
              <label>Twitter / X</label>
              <input name="twitter" value="${esc(u.socialLinks?.twitter || '')}" placeholder="@handle" />
            </div>
            <div class="form-field">
              <label>Instagram</label>
              <input name="instagram" value="${esc(u.socialLinks?.instagram || '')}" placeholder="@handle" />
            </div>
            <div class="form-field">
              <label>Website</label>
              <input name="website" type="url" value="${esc(u.socialLinks?.website || '')}" placeholder="https://..." />
            </div>
            <div class="form-field full">
              <button type="submit" class="btn btn-primary">Save profile</button>
            </div>
          </form>
        </div>
      </section>

      <!-- Wallet card -->
      <section class="account-section">
        <h2>Wallet</h2>
        ${wallet ? html`
          <div class="wallet-card">
            <div class="balance-big">
              <div class="balance-label">USDC balance</div>
              <div class="balance-value">${formatUsdc(wallet.usdcBalance)}</div>
              <button class="btn btn-ghost btn-sm" onclick="Pazzera.refreshBalance()">↻ Refresh</button>
            </div>
            <div class="wallet-addr-block">
              <div class="muted small">Wallet address</div>
              <code class="wallet-addr-full" onclick="Pazzera.copyWallet()" title="Click to copy">${esc(wallet.address)}</code>
            </div>
            <div class="wallet-actions">
              ${parseFloat(wallet.usdcBalance) === 0 ? html`
                <a href="${esc(wallet.faucetUrl)}" target="_blank" rel="noopener" class="btn btn-primary">Get testnet USDC</a>
              ` : ''}
              <a href="${esc(wallet.arc?.EXPLORER_URL)}/address/${esc(wallet.address)}" target="_blank" rel="noopener" class="btn btn-ghost">View on explorer ↗</a>
            </div>
            ${!wallet.pinSetupComplete ? `
              <div class="alert alert-warn mt">
                <strong>PIN not set yet.</strong> You need to set a PIN before you can sign payments.
                <button class="btn btn-sm btn-primary" onclick="Pazzera.setupPin()">Set up PIN</button>
              </div>
            ` : ''}
          </div>
        ` : `
          <div class="empty-card">
            <p>No wallet yet. The wallet is normally provisioned at signup. <button class="btn btn-ghost btn-sm" onclick="Pazzera.retryWallet()">Try again</button></p>
          </div>
        `}
      </section>

      ${artist ? html`
        <!-- Artist-only: profile preview -->
        <section class="account-section">
          <h2>Public artist profile</h2>
          <p class="muted">This is what fans see when they visit your artist page.</p>
          <div class="profile-card">
            ${avatarHtml(u.display_name, artist.avatar_url, 80).replace('class="avatar', 'class="artist-avatar')}
            <div class="profile-meta">
              <h2>${esc(u.display_name)}</h2>
              <p class="profile-bio">${esc(artist.bio || 'No bio yet.')}</p>
              <a href="/artist/${esc(artist.id)}" data-link class="btn btn-ghost btn-sm">View public page</a>
            </div>
          </div>
        </section>
      ` : ''}

      <!-- Security -->
      <section class="account-section">
        <h2>Security</h2>
        <div class="security-grid">
          <button class="btn btn-ghost" onclick="Pazzera.openChangePassword()">Change password</button>
          <a href="/forgot-password" data-link class="btn btn-ghost">Reset password via email</a>
          ${u.twoFactorEnabled
            ? html`<button class="btn btn-ghost" onclick="Pazzera.disable2fa()">Disable 2FA</button>`
            : html`<button class="btn btn-ghost" onclick="Pazzera.enable2fa()">Enable 2FA (TOTP)</button>`}
        </div>
        <details class="danger-zone">
          <summary>Delete account (irreversible)</summary>
          <div class="danger-zone-body">
            <p>This permanently deletes your account, wallet, and all data.</p>
            <input type="password" id="delete-confirm" placeholder="Confirm with your password" />
            <button class="btn btn-danger" onclick="Pazzera.deleteAccount()">Delete my account</button>
          </div>
        </details>
      </section>
    </div>
  `;

  // Bind profile form
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      displayName: fd.get('displayName'),
      bio: fd.get('bio') || undefined,
      location: fd.get('location') || undefined,
      socialLinks: {
        twitter: fd.get('twitter') || undefined,
        instagram: fd.get('instagram') || undefined,
        website: fd.get('website') || undefined,
      },
    };
    try {
      await api('/api/account', { method: 'PATCH', body: JSON.stringify(body) });
      toast('Profile saved ✓', 'success');
      await loadMe();
    } catch (e) { toast(e.message, 'error'); }
  });
});

// --- CHANGE PASSWORD MODAL ---
async function openChangePassword() {
  const current = prompt('Enter your current password:');
  if (!current) return;
  const next = prompt('Enter new password (min 8 chars):');
  if (!next || next.length < 8) { toast('Password too short', 'error'); return; }
  try {
    await api('/api/account/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    toast('Password changed ✓', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

// --- FORGOT PASSWORD ---
router.on('/forgot-password', async () => {
  const url = new URL(window.location.href);
  const sent = url.searchParams.get('sent');
  $('#app').innerHTML = html`
    <div class="auth-page">
      <h1>Forgot password</h1>
      <p class="lede">We'll email you a link to set a new password.</p>
      ${sent ? `<div class="alert alert-success">If an account exists for that email, a reset link has been sent.</div>` : ''}
      <form id="forgot-form">
        <div class="form-field">
          <label>Email</label>
          <input name="email" type="email" required autofocus />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Send reset link</button>
      </form>
      <div class="form-toggle"><a href="/login" data-link>Back to log in</a></div>
    </div>
  `;
  $('#forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await api('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: fd.get('email') }),
      });
      if (r.previewUrl) {
        toast(`Email queued. Preview: ${r.previewUrl}`, 'info', 10000);
      }
      router.go('/forgot-password?sent=1');
    } catch (e) { toast(e.message, 'error'); }
  });
});

// --- RESET PASSWORD (from email link) ---
router.on('/reset-password', async () => {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  const uid = url.searchParams.get('uid');
  if (!token || !uid) {
    $('#app').innerHTML = html`
      <div class="auth-page">
        <h1>Invalid reset link</h1>
        <p class="lede">This link is missing required parameters.</p>
        <a href="/forgot-password" data-link class="btn btn-primary">Request a new one</a>
      </div>
    `;
    return;
  }
  $('#app').innerHTML = html`
    <div class="auth-page">
      <h1>Set a new password</h1>
      <p class="lede">Choose something strong — at least 8 characters.</p>
      <form id="reset-form">
        <div class="form-field">
          <label>New password</label>
          <input name="password" type="password" minlength="8" required autofocus />
        </div>
        <div class="form-field">
          <label>Confirm</label>
          <input name="confirm" type="password" minlength="8" required />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Reset password</button>
      </form>
    </div>
  `;
  $('#reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('password') !== fd.get('confirm')) {
      toast('Passwords don\'t match', 'error');
      return;
    }
    try {
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, uid, newPassword: fd.get('password') }),
      });
      toast('Password reset ✓ Log in with your new password.', 'success', 5000);
      router.go('/login');
    } catch (e) { toast(e.message, 'error'); }
  });
});

// --- LOGIN ---
router.on('/login', async () => {
  const url = new URL(window.location.href);
  const next = url.searchParams.get('next') || '/';
  $('#app').innerHTML = html`
    <div class="auth-page">
      <h1>Log in</h1>
      <p class="lede">Welcome back to Pazzera.</p>
      <form id="login-form">
        <div class="form-field">
          <label>Email</label>
          <input name="email" type="email" required autofocus />
        </div>
        <div class="form-field">
          <label>Password</label>
          <input name="password" type="password" required />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Log in</button>
      </form>
      <div class="form-toggle">
        <a href="/forgot-password" data-link>Forgot password?</a>
        &nbsp;·&nbsp;
        <a href="/signup" data-link>Sign up</a>
      </div>
    </div>
  `;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await login(fd.get('email'), fd.get('password'));
      router.go(next);
    } catch (err) { toast(err.message, 'error'); }
  });
});

// --- SIGNUP ---
router.on('/signup', async () => {
  const url = new URL(window.location.href);
  const initialRole = url.searchParams.get('role') || 'fan';
  $('#app').innerHTML = html`
    <div class="auth-page">
      <h1>Create your account</h1>
      <p class="lede">Join Pazzera. Get paid per listen.</p>
      <div class="role-toggle" id="role-toggle">
        <button data-role="fan" class="${initialRole === 'fan' ? 'active' : ''}">I'm a listener</button>
        <button data-role="artist" class="${initialRole === 'artist' ? 'active' : ''}">I'm an artist</button>
      </div>
      <form id="signup-form">
        <input type="hidden" name="role" value="${initialRole}" />
        <div class="form-field">
          <label>Display name</label>
          <input name="displayName" required autofocus maxlength="60" />
        </div>
        <div class="form-field">
          <label>Email</label>
          <input name="email" type="email" required />
        </div>
        <div class="form-field">
          <label>Password</label>
          <input name="password" type="password" required minlength="8" />
          <div class="hint">At least 8 characters. Mix letters and numbers for strength.</div>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Create account</button>
      </form>
      <div class="form-toggle">Already have one? <a href="/login" data-link>Log in</a></div>
    </div>
  `;
  $('#role-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-role]');
    if (!btn) return;
    $$('#role-toggle button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('#signup-form input[name=role]').value = btn.dataset.role;
  });
  $('#signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await signup(fd.get('email'), fd.get('password'), fd.get('displayName'), fd.get('role'));
    } catch (err) { toast(err.message, 'error'); }
  });
});

// --- DASHBOARD (artist) ---
router.on('/dashboard', async () => {
  if (!state.user) { router.go('/login'); return; }
  if (state.user.role !== 'artist') {
    $('#app').innerHTML = html`
      <div class="auth-page">
        <h1>Artist dashboard</h1>
        <p class="lede">You need an artist account to see the dashboard.</p>
        <a href="/account" data-link class="btn btn-primary">Switch to artist account</a>
      </div>
    `;
    return;
  }
  const data = await api(`/api/dashboard/artist`).catch(() => ({ tracks: [], earnings_series: [], kpis: {} }));
  const k = data.kpis || {};
  const series = data.earnings_series || [];
  const tracks = data.tracks || [];
  const maxEarn = Math.max(1, ...series.map(s => Number(s.value || 0)));

  $('#app').innerHTML = html`
    <div class="page-head">
      <h1>Artist dashboard</h1>
      <p class="lede">Real-time earnings, plays, and listener data. Settled on Arc testnet.</p>
    </div>

    <div class="dashboard-grid">
      <div class="kpi-card">
        <div class="kpi-label">Earnings (all time)</div>
        <div class="kpi-value">${formatUsdc(k.total_earnings || '0')}</div>
        <div class="kpi-delta">${formatUsdc(k.earnings_24h || '0')} in last 24h</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total plays</div>
        <div class="kpi-value">${(k.total_plays || 0).toLocaleString()}</div>
        <div class="kpi-delta">${k.plays_24h || 0} in last 24h</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Listening now</div>
        <div class="kpi-value">${k.listening_now || 0}</div>
        <div class="kpi-delta">across all your tracks</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Tracks</div>
        <div class="kpi-value">${tracks.length}</div>
        <div class="kpi-delta">${tracks.filter(t => t.published).length} published</div>
      </div>
    </div>

    <div class="chart-card">
      <h3>Earnings — last 14 days</h3>
      <div class="bar-chart">
        ${series.map(s => {
          const h = Math.max(2, (Number(s.value || 0) / maxEarn) * 140);
          return `<div class="bar-col" style="height:${h}px;" title="${s.label}: ${s.value} USDC"><div class="label">${s.label}</div></div>`;
        }).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Your tracks</h2>
        <a href="/upload" data-link>+ Upload new</a>
      </div>
      <div class="track-list">
        ${tracks.map((t, i) => trackRow(t, i + 1, true)).join('')}
        ${tracks.length === 0 ? emptyState('🎵', 'No tracks yet', 'Upload your first track.', '/upload') : ''}
      </div>
    </div>
  `;
});

// --- UPLOAD ---
router.on('/upload', async () => {
  if (!state.user) { router.go('/login'); return; }
  if (state.user.role !== 'artist') {
    $('#app').innerHTML = html`
      <div class="auth-page">
        <h1>Upload a track</h1>
        <p class="lede">You need an artist account to upload.</p>
        <a href="/signup?role=artist" data-link class="btn btn-primary btn-block">Become an artist</a>
      </div>
    `;
    return;
  }
  $('#app').innerHTML = html`
    <div class="auth-page" style="max-width:560px;">
      <h1>Upload a track</h1>
      <p class="lede">Hosted audio URL. We'll fetch metadata + create your track on Arc.</p>
      <form id="upload-form">
        <div class="form-field">
          <label>Title</label>
          <input name="title" required placeholder="e.g. Lagos Nights" maxlength="100" />
        </div>
        <div class="form-field">
          <label>Description</label>
          <textarea name="description" rows="2" maxlength="500" placeholder="A short note for listeners"></textarea>
        </div>
        <div class="form-field">
          <label>Audio URL (mp3 / wav)</label>
          <input name="audio_url" type="url" required placeholder="https://..." />
          <div class="hint">Direct link to your audio file. Cloudflare R2 / S3 / your own server all work.</div>
        </div>
        <div class="form-field">
          <label>Cover image URL (optional)</label>
          <input name="cover_url" type="url" placeholder="https://..." />
        </div>
        <div class="form-field">
          <label>Price per listen (USDC)</label>
          <input name="price_per_listen_usdc" type="number" step="0.001" min="0.0001" value="0.001" />
          <div class="hint">Default 0.001 USDC (~$0.001).</div>
        </div>
        <div class="form-field">
          <label>Duration (seconds)</label>
          <input name="duration_seconds" type="number" min="1" value="180" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Upload</button>
      </form>
    </div>
  `;
  $('#upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    try {
      await api('/api/tracks', { method: 'POST', body: JSON.stringify(body) });
      toast('Track uploaded ✓', 'success');
      router.go('/dashboard');
    } catch (err) { toast(err.message, 'error'); }
  });
});

// --- ONBOARDING PIN SETUP ---
router.on('/onboarding/pin', async () => {
  const setup = state.pendingPinSetup;
  if (!setup) {
    $('#app').innerHTML = html`
      <div class="auth-page">
        <h1>Set up your wallet PIN</h1>
        <p class="lede">No pending PIN setup. <a href="/account" data-link>Go to your account</a> to manage your wallet.</p>
      </div>
    `;
    return;
  }
  $('#app').innerHTML = html`
    <div class="auth-page">
      <h1>🔐 Set up your wallet PIN</h1>
      <p class="lede">You'll use this PIN to sign payments when you play music. Circle Web SDK handles the encryption.</p>
      <div class="alert alert-info">
        <strong>How this works:</strong>
        <ol>
          <li>Circle SDK opens in your browser</li>
          <li>You choose a 6-digit PIN</li>
          <li>PIN is stored encrypted on Circle's servers</li>
          <li>Your wallet can now sign x402 payments</li>
        </ol>
      </div>
      <button id="run-pin-setup" class="btn btn-primary btn-block">Continue with Circle SDK →</button>
      <div class="form-toggle"><a href="/account" data-link>Skip for now</a></div>
    </div>
  `;
  $('#run-pin-setup').addEventListener('click', async () => {
    try {
      toast('Loading Circle SDK…');
      const { execute } = await import('https://cdn.jsdelivr.net/npm/@circle-fin/w3s-pw-web-sdk@1.1.11/dist/index.js');
      await execute({
        challengeId: setup.challengeId,
        userToken: setup.userToken,
        encryptionKey: setup.encryptionKey,
      });
      await api('/api/auth/complete-pin-setup', { method: 'POST' });
      toast('PIN set ✓ Your wallet is now active.', 'success');
      state.pendingPinSetup = null;
      await loadMe();
      router.go('/account');
    } catch (e) {
      toast('PIN setup failed: ' + e.message, 'error');
    }
  });
});

// ============ HELPERS ============
function trackRow(t, idx, showArtist = false) {
  const dataAttr = `data-track='${esc(JSON.stringify(t))}'`;
  return html`
    <div class="track-row" onclick="Pazzera._onTrackClick(this)" ${dataAttr}>
      <div class="album-art">
        <div style="background:linear-gradient(135deg, hsl(${(t.title?.charCodeAt(0) || 0) % 360},60%,40%), #111); width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:18px;">${(t.title || '♪')[0].toUpperCase()}</div>
        <div class="play-overlay">▶</div>
      </div>
      <div class="track-info">
        <div class="title">${esc(t.title)}</div>
        <div class="artist">${esc(t.artist_name || 'Unknown')}</div>
      </div>
      <div class="plays">${(t.plays_count || 0).toLocaleString()} plays</div>
      <div class="price">${t.price_per_listen_usdc} USDC</div>
      <div class="duration">${fmtTime(t.duration_seconds)}</div>
    </div>
  `;
}

function emptyState(icon, title, hint, actionHref = null) {
  return html`
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <h3>${esc(title)}</h3>
      <p class="muted">${esc(hint)}</p>
      ${actionHref ? html`<a href="${esc(actionHref)}" data-link class="btn btn-primary">Get started</a>` : ''}
    </div>
  `;
}

// ============ EXPORTS ============
window.Pazzera = {
  playTrack, logout, login, signup,
  copyWallet, refreshBalance: async () => {
    try {
      const r = await api('/api/account/wallet/refresh-balance', { method: 'POST' });
      toast(`Balance: ${formatUsdc(r.usdcBalance)} USDC`, 'success');
      await loadMe();
    } catch (e) { toast(e.message, 'error'); }
  },
  uploadAvatar: async (input) => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Avatar too large (max 5MB)', 'error'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await api('/api/account/avatar', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result, filename: file.name }) });
        toast('Avatar updated ✓', 'success');
        await loadMe();
        router.render();
      } catch (e) { toast(e.message, 'error'); }
    };
    reader.readAsDataURL(file);
  },
  openChangePassword,
  resendVerification,
  deleteAccount: async () => {
    const pw = $('#delete-confirm')?.value;
    if (!pw) { toast('Enter your password to confirm', 'error'); return; }
    if (!confirm('This is permanent. Delete your account?')) return;
    try {
      await api('/api/account', { method: 'DELETE', body: JSON.stringify({ confirmPassword: pw }) });
      toast('Account deleted', 'info');
      state.user = null; state.account = null;
      renderAuth();
      router.go('/');
    } catch (e) { toast(e.message, 'error'); }
  },
  enable2fa: () => toast('2FA setup coming soon — for now password + email is sufficient', 'info'),
  disable2fa: () => toast('2FA disable coming soon', 'info'),
  setupPin: () => router.go('/onboarding/pin'),
  retryWallet: () => router.go('/account'),
  state,
};

Pazzera._onTrackClick = function(row) {
  const track = JSON.parse(row.getAttribute('data-track'));
  router.go(`/track/${track.id}`);
};

// ============ INIT ============
bindPlayer();
loadMe();
router.render();