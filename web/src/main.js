// Pazzera — main client app
// Modern dark mode music platform with pay-per-listen on Arc

const API = window.PAZZERA_API || 'https://api.pazzera.com';

// ============ STATE ============
const state = {
  user: null,           // { id, email, displayName, role, wallet? }
  currentTrack: null,   // currently playing track
  audio: null,
  isPlaying: false,
  listeningNowCount: 0,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const html = (s, ...vals) => s.reduce((acc, str, i) => acc + str + (vals[i] ?? ''), '');

// ============ TOAST ============
let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
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
      throw new Error(msg);
    }
    return body;
  } catch (e) {
    if (e.name === 'TypeError') throw new Error(`Network error: ${e.message}`);
    throw e;
  }
}

// ============ AUTH ============
async function loadMe() {
  try {
    state.user = await api('/api/auth/me');
  } catch {
    state.user = null;
  }
  renderAuth();
}

async function signup(email, password, displayName, role) {
  const res = await api('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName, role }),
  });
  state.user = res.user || { email, displayName, role };
  // Store session token if present
  if (res.token) localStorage.setItem('pazzera_token', res.token);
  toast('Welcome to Pazzera 🎵', 'success');
  router.go('/');
  await loadMe();
}

async function login(email, password) {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  state.user = res.user;
  if (res.token) localStorage.setItem('pazzera_token', res.token);
  toast('Welcome back', 'success');
  router.go('/');
  await loadMe();
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  state.user = null;
  localStorage.removeItem('pazzera_token');
  toast('Logged out');
  renderAuth();
  router.go('/');
}

function renderAuth() {
  const area = $('#auth-area');
  if (state.user) {
    area.innerHTML = html`
      <div class="row">
        <a href="/dashboard" data-link class="wallet-pill">
          <span>${state.user.displayName || state.user.email}</span>
        </a>
        <button class="btn btn-ghost btn-sm" onclick="Pazzera.logout()">Logout</button>
      </div>
    `;
  } else {
    area.innerHTML = html`
      <div class="row">
        <a href="/login" data-link class="btn btn-ghost btn-sm">Log in</a>
        <a href="/signup" data-link class="btn btn-primary btn-sm">Sign up</a>
      </div>
    `;
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
      app.innerHTML = html`<div class="loading"><h2>Page not found</h2><p class="muted"><a href="/" data-link>Go home</a></p></div>`;
      return;
    }
    app.innerHTML = html`<div class="loading"><div class="spinner"></div></div>`;
    window.scrollTo({ top: 0, behavior: 'instant' });
    try {
      await match.handler(match.params);
    } catch (e) {
      console.error(e);
      app.innerHTML = html`<div class="loading"><h2>Something went wrong</h2><p class="muted">${e.message}</p></div>`;
    }
    // Highlight active nav
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
  // Deterministic gradient from string
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
    $('#listening-now-count').textContent = count;
  } catch {
    // ignore
  }
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
  // Check skip-gating
  const lastPlay = state._lastPlay?.[track.id];
  const now = Date.now();
  if (lastPlay && now - lastPlay < (track.replay_cooldown_seconds ?? 30) * 1000) {
    // Free replay within cooldown — just play
    showPlayer(track, track.audio_url);
    toast(`Replay (free within ${track.replay_cooldown_seconds}s cooldown)`);
    return;
  }
  // Need to charge
  try {
    toast('Preparing payment…');
    const challenge = await api('/api/play/start', {
      method: 'POST',
      body: JSON.stringify({ trackId: track.id }),
    });
    // In demo mode the server returns skip=true. For real x402, we'd prompt
    // the Circle Web SDK to sign the EIP-712 typed-data here.
    if (challenge.skip) {
      showPlayer(track, track.audio_url);
      toast('Playing (preview free)');
    } else {
      // Real flow: hand the typed-data to Circle Web SDK → sign → return
      // For now, simulate by POSTing the signature
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
  // Placeholder — real Circle Web SDK would do EIP-712 sign here
  return '0x' + '00'.repeat(65);
}

window.Pazzera = { playTrack, logout, state };

// ============ PAGES ============

// --- HOME / BROWSE ---
router.on('/', async () => {
  const [featured, tracks, listeningNow] = await Promise.all([
    api('/api/artists').catch(() => ({ artists: [] })),
    api('/api/tracks').catch(() => ({ tracks: [] })),
    api('/api/stats/listening-now').catch(() => ({ count: 0 })),
  ]);
  const artists = featured.artists || [];
  const topTracks = (tracks.tracks || []).slice(0, 12);

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
              <div class="meta">${a.followers_count ?? 0} listeners</div>
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
        ${topTracks.length === 0 ? html`<p class="muted">No tracks yet. Be the first to upload.</p>` : ''}
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

// --- ARTIST PROFILE ---
router.on('/artist/:id', async ({ id }) => {
  const data = await api(`/api/artists/${id}`);
  const a = data.artist;
  const tracks = data.tracks || [];
  const stats = await api(`/api/stats/artist/${id}`).catch(() => ({ total_plays: 0, total_earnings_usdc: '0', listeners: 0 }));

  $('#app').innerHTML = html`
    <div class="profile-card">
      <div class="big-avatar">${(a.display_name || '?')[0].toUpperCase()}</div>
      <div class="profile-meta">
        <div class="meta-type">Artist</div>
        <h1>${esc(a.display_name || 'Unknown artist')}</h1>
        <p class="profile-bio">${esc(a.bio || 'No bio yet.')}</p>
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
        ${tracks.length === 0 ? html`<p class="muted">No tracks published yet.</p>` : ''}
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
          <button class="btn btn-primary" onclick="Pazzera.playTrack(${JSON.stringify(t).replace(/"/g, '&quot;')})">▶ Pay & Play</button>
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

// --- DASHBOARD ---
router.on('/dashboard', async () => {
  if (!state.user) {
    router.go('/login');
    return;
  }
  if (state.user.role !== 'artist') {
    router.go('/');
    toast('Switch to an artist account to see the dashboard', 'error');
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
        ${tracks.length === 0 ? html`<p class="muted">No tracks yet. <a href="/upload" data-link style="color:var(--accent)">Upload your first →</a></p>` : ''}
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
        <p class="lede">You need an artist account to upload. Switch to one in your profile settings.</p>
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
          <input name="title" required placeholder="e.g. Lagos Nights" />
        </div>
        <div class="form-field">
          <label>Description</label>
          <textarea name="description" rows="2" placeholder="A short note for listeners"></textarea>
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
          <div class="hint">Default 0.001 USDC (~$0.001). Fan signs + pays this every play.</div>
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
    } catch (err) {
      toast(err.message, 'error');
    }
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
      <div class="form-toggle">No account? <a href="/signup" data-link>Sign up</a></div>
    </div>
  `;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await login(fd.get('email'), fd.get('password'));
      router.go(next);
    } catch (err) {
      toast(err.message, 'error');
    }
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
          <input name="displayName" required autofocus />
        </div>
        <div class="form-field">
          <label>Email</label>
          <input name="email" type="email" required />
        </div>
        <div class="form-field">
          <label>Password</label>
          <input name="password" type="password" required minlength="6" />
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
    } catch (err) {
      toast(err.message, 'error');
    }
  });
});

// ============ HELPERS ============
function trackRow(t, idx, showArtist = false) {
  const dataAttr = `data-track='${JSON.stringify(t).replace(/'/g, '&#39;')}'`;
  return html`
    <div class="track-row" onclick="Pazzera._onTrackClick(this)" ${dataAttr}>
      <div class="album-art">
        <div style="background:linear-gradient(135deg, hsl(${(t.title?.charCodeAt(0) || 0) % 360},60%,40%), #111); width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:18px;">${(t.title || '♪')[0].toUpperCase()}</div>
        <div class="play-overlay">▶</div>
      </div>
      <div class="track-info">
        <div class="title">${esc(t.title)}</div>
        <div class="artist">${esc(showArtist ? (t.artist_name || 'Unknown') : (t.artist_name || 'Unknown'))}</div>
      </div>
      <div class="plays">${(t.plays_count || 0).toLocaleString()} plays</div>
      <div class="price">${t.price_per_listen_usdc} USDC</div>
      <div class="duration">${fmtTime(t.duration_seconds)}</div>
    </div>
  `;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function formatUsdc(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '0.00';
  if (n === 0) return '0.00';
  if (n < 0.01) return n.toFixed(6);
  return n.toFixed(2);
}

Pazzera._onTrackClick = function(row) {
  const track = JSON.parse(row.getAttribute('data-track').replace(/&#39;/g, "'"));
  router.go(`/track/${track.id}`);
};

// ============ INIT ============
bindPlayer();
loadMe();
router.render();
