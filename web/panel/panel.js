/* ============================================================================
   SmartPrice — админ панел (логика). Без външни библиотеки.
   Всичко минава през /api/admin/* с токен от /api/admin/login.
   ============================================================================ */

const TOKEN_KEY = 'smartprice_admin_token_v1';
const state = { token: localStorage.getItem(TOKEN_KEY) || '', admin: null, page: 'overview' };
const cache = {};

/* ------------------------------------------------------------- помощни */

const $ = (sel) => document.querySelector(sel);

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const nf = new Intl.NumberFormat('bg-BG');
const num = (v) => nf.format(Number(v ?? 0));
const money = (v) => `${Number(v ?? 0).toFixed(2)} €`;

function dt(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ago(v) {
  if (!v) return 'никога';
  const diff = Date.now() - new Date(v).getTime();
  if (Number.isNaN(diff)) return '—';
  const min = Math.round(diff / 60000);
  if (min < 1) return 'сега';
  if (min < 60) return `преди ${min} мин`;
  const h = Math.round(min / 60);
  if (h < 24) return `преди ${h} ч`;
  const d = Math.round(h / 24);
  return `преди ${d} д`;
}

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'ok' ? '' : kind}`;
  el.innerHTML = `<strong>${kind === 'error' ? '⚠️' : kind === 'warn' ? '❗' : '✅'}</strong> ${esc(message)}`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

/* --------------------------------------------------------------- API */

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(`/api/admin${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { message: text.slice(0, 200) } };
    }
  }

  if (res.status === 401) {
    logout(true);
    throw new Error(data?.error?.message || 'Сесията изтече. Влез отново.');
  }
  if (!res.ok) throw new Error(data?.error?.message || `Грешка ${res.status}`);
  return data;
}

/* -------------------------------------------------------------- вход */

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  const err = $('#login-error');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Проверявам…';
  try {
    const data = await api('/login', {
      method: 'POST',
      body: { email: $('#login-email').value.trim(), password: $('#login-password').value },
    });
    state.token = data.token;
    state.admin = data.admin;
    localStorage.setItem(TOKEN_KEY, data.token);
    showApp();
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Влез';
  }
});

function logout(silent = false) {
  state.token = '';
  state.admin = null;
  localStorage.removeItem(TOKEN_KEY);
  $('#app').hidden = true;
  $('#login').hidden = false;
  if (!silent) toast('Излезе от панела');
}

$('#logout-btn').addEventListener('click', () => logout());

async function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  if (!state.admin) {
    try {
      const me = await api('/me');
      state.admin = me.admin;
    } catch {
      return;
    }
  }
  $('#who').innerHTML = `<strong>${esc(state.admin.name || '')}</strong><br>${esc(state.admin.email)}`;
  $('#stamp').textContent = `Заредено: ${new Date().toLocaleTimeString('bg-BG')}`;
  navigate(state.page || 'overview');
}

/* ---------------------------------------------------------- навигация */

const PAGES = {
  overview: ['Преглед', 'Какво се случва в приложението в реално време'],
  users: ['Потребители', 'Търси, редактирай, спри или изтрий профил'],
  posts: ['Оферти', 'Всички оферти с ID, локация и модерация'],
  raffles: ['Томболи', 'Създай томбола, сложи наградата със снимка и я разиграй'],
  comments: ['Коментари', 'Преглед и модерация на коментарите'],
  reports: ['Сигнали', 'Какво сигнализират потребителите'],
  categories: ['Категории', 'Етикети и думи за търсене'],
  referrals: ['Покани', 'Кой кого е поканил и кой е получил точки'],
  favorites: ['Любими', 'Кои оферти хората пазят най-често'],
  security: ['Сигурност', 'Ненормална активност и аларми по имейл'],
  emails: ['Имейли', 'Изпратени писма и ръчно писмо до потребител'],
  audit: ['Дневник', 'Всяко действие на админ — кой, какво, кога'],
};

$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (btn) navigate(btn.dataset.page);
});

function navigate(page) {
  state.page = page;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  const [title, sub] = PAGES[page] || ['Панел', ''];
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  render(page);
}

$('#reload-btn').addEventListener('click', () => render(state.page, true));

/* ---------------------------------------------------------- графики */

function lineChart(series, keys) {
  // series: [{day, users, posts, comments, active}]
  const w = 600;
  const h = 150;
  const pad = 6;
  const colors = { users: '#6366F1', posts: '#06B6D4', comments: '#FBBF24', active: '#22C55E' };
  const max = Math.max(1, ...series.flatMap((r) => keys.map((k) => Number(r[k] || 0))));
  const step = series.length > 1 ? (w - pad * 2) / (series.length - 1) : 0;

  const paths = keys.map((k) => {
    const pts = series.map((r, i) => {
      const x = pad + i * step;
      const y = h - pad - (Number(r[k] || 0) / max) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `<polyline fill="none" stroke="${colors[k] || '#94A3B8'}" stroke-width="2" stroke-linejoin="round" points="${pts.join(' ')}" />`;
  });

  const labels = {
    users: 'нови профили',
    posts: 'оферти',
    comments: 'коментари',
    active: 'влезли',
  };

  return `
    <svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${paths.join('')}</svg>
    <div class="legend">${keys
      .map((k) => `<span><i style="background:${colors[k]}"></i>${labels[k] || k}</span>`)
      .join('')}<span class="dim">най-високо: ${num(max)}</span></div>`;
}

function barList(items, labelKey, valueKey) {
  const max = Math.max(1, ...items.map((i) => Number(i[valueKey] || 0)));
  return items
    .map(
      (i) => `
      <div class="bar-row">
        <div class="bar-label">${esc(i[labelKey])}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${((Number(i[valueKey]) / max) * 100).toFixed(1)}%"></div></div>
        <div class="bar-val">${num(i[valueKey])}</div>
      </div>`
    )
    .join('');
}

/* --------------------------------------------------------- рендериране */

async function render(page, force = false) {
  const box = $('#page');
  box.innerHTML = `<div class="card"><span class="spinner"></span> Зареждам…</div>`;
  try {
    if (page === 'overview') return await renderOverview(box, force);
    if (page === 'users') return await renderUsers(box, force);
    if (page === 'posts') return await renderPosts(box, force);
    if (page === 'raffles') return await renderRaffles(box, force);
    if (page === 'comments') return await renderComments(box, force);
    if (page === 'reports') return await renderReports(box, force);
    if (page === 'categories') return await renderCategories(box, force);
    if (page === 'referrals') return await renderReferrals(box, force);
    if (page === 'favorites') return await renderFavorites(box, force);
    if (page === 'security') return await renderSecurity(box, force);
    if (page === 'emails') return await renderEmails(box, force);
    if (page === 'audit') return await renderAudit(box, force);
  } catch (e) {
    box.innerHTML = `<div class="card"><div class="hint warn">${esc(e.message)}</div></div>`;
  } finally {
    // Всяка страница се рисува наново — тук подменяме нативните <select> с
    // нашите менюта. Така не зависим от наблюдатели и работи винаги.
    enhanceSelects();
  }
}

/* ------------------------------------------------------------ преглед */

async function renderOverview(box, force) {
  if (force || !cache.stats) cache.stats = await api('/stats');
  const s = cache.stats;

  const kpi = (label, value, sub, cls = '') => `
    <div class="card kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value ${cls}">${value}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`;

  box.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:14px">
      ${kpi('Потребители', num(s.users.total), `днес +${num(s.users.today)} · 7 дни +${num(s.users.week)}`, 'cyan')}
      ${kpi('Оферти', num(s.posts.total), `днес +${num(s.posts.today)} · публични ${num(s.posts.published)}`, 'green')}
      ${kpi('Коментари', num(s.engagement.comments), `днес +${num(s.engagement.comments_today)} · реакции ${num(s.engagement.reactions)}`)}
      ${kpi('Спестени пари', money(s.posts.saved_sum), `от общността, по оферти`, 'gold')}
    </div>

    <div class="grid grid-4" style="margin-bottom:14px">
      ${kpi('Влезли днес', num(s.users.active_today), `за 7 дни: ${num(s.users.active_week)}`)}
      ${kpi('Любими', num(s.engagement.bookmarks), `отметнати оферти`)}
      ${kpi('Покани', num(s.users.supporters ? s.users.supporters : 0) === 0 ? num(0) : num(s.users.supporters), `поддръжници на приложението`)}
      ${kpi('Дарения', money(s.money.donated_sum), `${num(s.money.donations_ok)} успешни`, 'gold')}
    </div>

    <div class="grid grid-2" style="margin-bottom:14px">
      <div class="card">
        <div class="card-title">📈 Растеж (последните 30 дни)</div>
        ${lineChart(s.growth, ['users', 'posts', 'comments'])}
      </div>
      <div class="card">
        <div class="card-title">👣 Активност (колко души влизат)</div>
        ${lineChart(s.activity, ['active'])}
      </div>
    </div>

    <div class="grid grid-3" style="margin-bottom:14px">
      <div class="card">
        <div class="card-title">🗂️ По категории</div>
        ${s.byCategory.length ? barList(s.byCategory, 'title', 'posts') : '<div class="empty">Още няма оферти</div>'}
      </div>
      <div class="card">
        <div class="card-title">📍 По градове</div>
        ${s.byCity.length ? barList(s.byCity, 'city', 'posts') : '<div class="empty">Още няма оферти</div>'}
      </div>
      <div class="card">
        <div class="card-title">🩺 Състояние</div>
        <dl class="dl" style="grid-template-columns:1fr auto">
          <dt>Отворени сигнали</dt><dd>${num(s.moderation.reports_open)}</dd>
          <dt>Отворени аларми</dt><dd>${num(s.moderation.alerts_open)}</dd>
          <dt>Грешни влизания (24 ч)</dt><dd>${num(s.moderation.failed_logins_24h)}</dd>
          <dt>Успешни влизания (24 ч)</dt><dd>${num(s.moderation.logins_24h)}</dd>
          <dt>Спрени профили</dt><dd>${num(s.users.suspended)}</dd>
          <dt>Изтрити профили</dt><dd>${num(s.users.deleted)}</dd>
          <dt>Активни томболи</dt><dd>${num(s.moderation.raffles_live)}</dd>
          <dt>Качени снимки</dt><dd>${num(s.engagement.uploads)} (${(Number(s.engagement.uploads_bytes || 0) / 1048576).toFixed(1)} MB)</dd>
          <dt>Имейли (24 ч)</dt><dd>${num(s.mail.last24h)}${s.mail.failed ? ` · грешки ${num(s.mail.failed)}` : ''}</dd>
        </dl>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:14px">
      <div class="card">
        <div class="card-title">🏆 Най-полезни оферти</div>
        ${
          s.topPosts.length
            ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Оферта</th><th>Помогнала</th><th>Коментари</th></tr></thead><tbody>
              ${s.topPosts
                .map(
                  (p) => `<tr><td class="mono">${esc(p.code)}</td><td>${esc(p.title)}</td>
                  <td>${num(p.helped)}</td><td>${num(p.comments)}</td></tr>`
                )
                .join('')}</tbody></table></div>`
            : '<div class="empty">Още няма данни</div>'
        }
      </div>
      <div class="card">
        <div class="card-title">👑 Най-активни потребители</div>
        ${
          s.topAuthors.length
            ? `<div class="table-wrap"><table><thead><tr><th>Профил</th><th>Оферти</th><th>Спестени</th></tr></thead><tbody>
              ${s.topAuthors
                .map(
                  (a) => `<tr><td>${esc(a.name)} <span class="dim">${esc(a.handle)}</span></td>
                  <td>${num(a.posts)}</td><td>${money(a.saved)}</td></tr>`
                )
                .join('')}</tbody></table></div>`
            : '<div class="empty">Още няма данни</div>'
        }
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">🆕 Нови профили</div>
        <div class="table-wrap"><table><thead><tr><th>Профил</th><th>Град</th><th>Оферти</th><th>Регистрация</th></tr></thead><tbody>
        ${s.recentUsers
          .map(
            (u) => `<tr>
              <td>${esc(u.name)} <span class="dim">${esc(u.handle)}</span>${u.suspended ? ' <span class="pill pill-red">спрян</span>' : ''}</td>
              <td>${esc(u.city || '—')}</td><td>${num(u.posts)}</td><td class="dim nowrap">${ago(u.created_at)}</td>
            </tr>`
          )
          .join('')}
        </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-title">🆕 Последни оферти</div>
        <div class="table-wrap"><table><thead><tr><th>ID</th><th>Оферта</th><th>Автор</th><th>Статус</th></tr></thead><tbody>
        ${s.recentPosts
          .map(
            (p) => `<tr>
              <td class="mono">${esc(p.code)}</td>
              <td>${esc(p.title)} <span class="dim">${esc(p.city || '')}</span></td>
              <td class="dim">${esc(p.author_handle)}</td>
              <td><span class="pill ${p.status === 'published' ? 'pill-green' : 'pill-dim'}">${esc(p.status)}</span></td>
            </tr>`
          )
          .join('')}
        </tbody></table></div>
      </div>
    </div>
  `;
}

/* -------------------------------------------------------- потребители */

async function renderUsers(box, force) {
  const f = (cache.usersFilter = force ? { search: '', status: 'all', role: 'all', sort: 'newest', offset: 0 } : cache.usersFilter || { search: '', status: 'all', role: 'all', sort: 'newest', offset: 0 });

  box.innerHTML = `
    <div class="toolbar">
      <input class="grow" id="u-search" placeholder="Търси по име, имейл, @handle или град…" value="${esc(f.search)}">
      <select id="u-status">
        <option value="all">Всички</option>
        <option value="active">Активни</option>
        <option value="suspended">Спрени</option>
        <option value="deleted">Изтрити</option>
        <option value="unverified">Непотвърдени</option>
      </select>
      <select id="u-role">
        <option value="all">Всички роли</option>
        <option value="user">Потребител</option>
        <option value="moderator">Модератор</option>
        <option value="admin">Админ</option>
      </select>
      <select id="u-sort">
        <option value="newest">Най-нови</option>
        <option value="oldest">Най-стари</option>
        <option value="most_posts">Най-много оферти</option>
        <option value="last_seen">Последно влизане</option>
      </select>
      <button class="btn" id="u-go">Търси</button>
    </div>
    <div id="u-list"><div class="card"><span class="spinner"></span></div></div>
  `;

  $('#u-status').value = f.status;
  $('#u-role').value = f.role;
  $('#u-sort').value = f.sort;

  const load = async () => {
    f.search = $('#u-search').value.trim();
    f.status = $('#u-status').value;
    f.role = $('#u-role').value;
    f.sort = $('#u-sort').value;
    const qs = new URLSearchParams({ search: f.search, status: f.status, role: f.role, sort: f.sort, limit: 50, offset: f.offset });
    const data = await api(`/users?${qs}`);
    $('#u-list').innerHTML = `
      <div class="dim" style="margin-bottom:8px">Намерени: <strong>${num(data.total)}</strong></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Профил</th><th>Имейл</th><th>Град</th><th>Оферти</th><th>Покани</th><th>Състояние</th><th>Влизал</th><th></th></tr></thead>
        <tbody>
        ${
          data.items.length
            ? data.items
                .map(
                  (u) => `<tr>
              <td><strong>${esc(u.name)}</strong><br><span class="dim mono">${esc(u.handle)}</span>
                ${u.role !== 'user' ? ` <span class="pill pill-gold">${esc(u.role)}</span>` : ''}
                ${u.is_supporter ? ' <span class="pill pill-cyan">поддръжник</span>' : ''}</td>
              <td class="mono" style="font-size:12.5px">${esc(u.email)}</td>
              <td>${esc(u.city || '—')}</td>
              <td>${num(u.posts_count)}</td>
              <td>${num(u.invited)}</td>
              <td>${
                u.deleted_at
                  ? '<span class="pill pill-red">изтрит</span>'
                  : u.suspended_at
                    ? '<span class="pill pill-gold">спрян</span>'
                    : u.email_verified_at
                      ? '<span class="pill pill-green">активен</span>'
                      : '<span class="pill pill-dim">непотвърден</span>'
              }</td>
              <td class="dim nowrap">${ago(u.last_seen_at)}</td>
              <td class="actions"><button class="btn btn-sm" data-user="${esc(u.id)}">Отвори</button></td>
            </tr>`
                )
                .join('')
            : '<tr><td colspan="8" class="empty">Няма намерени профили</td></tr>'
        }
        </tbody></table></div>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn btn-sm" id="u-prev" ${f.offset === 0 ? 'disabled' : ''}>← Предишни</button>
        <button class="btn btn-sm" id="u-next" ${f.offset + 50 >= data.total ? 'disabled' : ''}>Следващи →</button>
      </div>`;

    $('#u-prev').onclick = () => {
      f.offset = Math.max(0, f.offset - 50);
      load();
    };
    $('#u-next').onclick = () => {
      f.offset += 50;
      load();
    };
    document.querySelectorAll('[data-user]').forEach((b) => {
      b.onclick = () => openUser(b.dataset.user);
    });
  };

  $('#u-go').onclick = load;
  $('#u-search').onkeydown = (e) => {
    if (e.key === 'Enter') load();
  };
  await load();
}

/* ------------------------------------------------------ профил (прозорец) */

async function openUser(id) {
  openModal('Зареждам профил…', '<span class="spinner"></span>', [], true);
  let d;
  try {
    d = await api(`/users/${id}`);
  } catch (e) {
    return openModal('Грешка', `<div class="hint warn">${esc(e.message)}</div>`, []);
  }

  const p = d.profile;
  const suspended = p.suspended_at && (!p.suspended_until || new Date(p.suspended_until) > new Date());
  const gps = (lat, lng) => (lat && lng ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}` : '—');

  const body = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">👤 Профил</div>
        <dl class="dl">
          <dt>Име</dt><dd>${esc(p.name)}</dd>
          <dt>@handle</dt><dd class="mono">${esc(p.handle)}</dd>
          <dt>Имейл</dt><dd class="mono">${esc(p.email)}</dd>
          <dt>Град</dt><dd>${esc(p.city)}</dd>
          <dt>Роля</dt><dd>${esc(p.role)}</dd>
          <dt>Точки</dt><dd>${num(p.reputation_points)}</dd>
          <dt>Регистрация</dt><dd>${dt(p.created_at)} <span class="dim">(${ago(p.created_at)})</span></dd>
          <dt>Последно влизане</dt><dd>${dt(p.last_login_at)} <span class="dim">(${ago(p.last_login_at)})</span></dd>
          <dt>Влизания</dt><dd>${num(p.login_count)}</dd>
          <dt>IP при регистрация</dt><dd class="mono">${esc(p.signup_ip || '—')}</dd>
          <dt>Потвърден имейл</dt><dd>${p.email_verified_at ? '✅ да' : '❌ не'}</dd>
          <dt>Състояние</dt><dd>${
            p.deleted_at
              ? `<span class="pill pill-red">изтрит</span> <span class="dim">${esc(p.deleted_reason || '')}</span>`
              : suspended
                ? `<span class="pill pill-gold">спрян</span> ${p.suspended_until ? `до ${dt(p.suspended_until)}` : '(безсрочно)'}
                   <div class="dim">Причина: ${esc(p.suspended_reason || '—')}</div>`
                : '<span class="pill pill-green">активен</span>'
          }</dd>
        </dl>
      </div>

      <div class="card">
        <div class="card-title">📊 Активност</div>
        <dl class="dl" style="grid-template-columns:1fr auto">
          <dt>Оферти</dt><dd>${num(p.posts_count)}</dd>
          <dt>Коментари</dt><dd>${num(p.comments_count)}</dd>
          <dt>Реакции</dt><dd>${num(p.reactions_count)}</dd>
          <dt>Любими</dt><dd>${num(p.favorites_count)}</dd>
          <dt>Поканил</dt><dd>${num(p.invited)}</dd>
          <dt>Поканен от друг</dt><dd>${num(p.invited_by_someone)}</dd>
          <dt>Лично спестени</dt><dd>${money(p.personal_saved_bgn)}</dd>
          <dt>Дарил</dt><dd>${money(p.donated)}</dd>
          <dt>Реферален код</dt><dd class="mono">${esc(p.referral_code || '—')}</dd>
        </dl>

        <div class="card-title" style="margin-top:16px">✏️ Редакция</div>
        <div class="form-grid">
          <label class="field"><span>Име</span><input id="e-name" value="${esc(p.name)}"></label>
          <label class="field"><span>Град</span><input id="e-city" value="${esc(p.city)}"></label>
          <label class="field"><span>Роля</span>
            <select id="e-role">
              ${['user', 'moderator', 'admin'].map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span>Точки</span><input id="e-points" type="number" value="${Number(p.reputation_points)}"></label>
          <label class="field full"><span>Бележка (bio)</span><textarea id="e-bio">${esc(p.bio || '')}</textarea></label>
        </div>
        <button class="btn btn-primary" id="e-save">Запази промените</button>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:14px">
      <div class="card">
        <div class="card-title">🏷️ Последни оферти (${d.posts.length})</div>
        ${
          d.posts.length
            ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Заглавие</th><th>Статус</th></tr></thead><tbody>
              ${d.posts.map((x) => `<tr><td class="mono">${esc(x.public_code)}</td><td>${esc(x.title)}</td>
                <td><span class="pill ${x.status === 'published' ? 'pill-green' : 'pill-dim'}">${esc(x.status)}</span></td></tr>`).join('')}
              </tbody></table></div>`
            : '<div class="empty">Няма оферти</div>'
        }
      </div>
      <div class="card">
        <div class="card-title">🛡️ Опити за вход и аларми</div>
        ${
          d.loginAttempts.length
            ? `<div class="table-wrap"><table><thead><tr><th>IP</th><th>Резултат</th><th>Кога</th></tr></thead><tbody>
              ${d.loginAttempts
                .map(
                  (a) => `<tr><td class="mono">${esc(a.ip || '—')}</td>
                <td>${a.ok ? '<span class="pill pill-green">успех</span>' : `<span class="pill pill-red">${esc(a.reason || 'грешка')}</span>`}</td>
                <td class="dim nowrap">${ago(a.created_at)}</td></tr>`
                )
                .join('')}</tbody></table></div>`
            : '<div class="empty">Няма опити</div>'
        }
        ${
          d.securityEvents.length
            ? `<div style="margin-top:12px">${d.securityEvents
                .map(
                  (s) => `<div class="hint ${s.severity === 'critical' ? 'warn' : ''}" style="margin-bottom:8px">
                  <strong>${esc(s.title)}</strong><div class="dim">${dt(s.created_at)}</div></div>`
                )
                .join('')}</div>`
            : ''
        }
      </div>
    </div>

    ${
      d.audit.length
        ? `<div class="card" style="margin-top:14px"><div class="card-title">📜 Действия по този профил</div>
            ${d.audit.map((a) => `<div class="dim" style="margin-bottom:5px">${dt(a.created_at)} · <strong>${esc(a.action)}</strong> от ${esc(a.admin_email)}</div>`).join('')}
          </div>`
        : ''
    }
  `;

  const foot = [];
  if (!p.deleted_at) {
    if (suspended) {
      foot.push({ id: 'f-resume', label: '▶ Пусни профила', cls: 'btn-ok' });
    } else {
      foot.push({ id: 'f-suspend', label: '⏸ Спри временно', cls: 'btn-warn' });
    }
    foot.push({ id: 'f-mail', label: '✉️ Писмо', cls: '' });
    foot.push({ id: 'f-delete', label: '🗑 Изтрий профила', cls: 'btn-danger' });
  }

  openModal(`Профил · ${p.handle}`, body, foot, true);

  $('#e-save').onclick = async () => {
    try {
      await api(`/users/${id}`, {
        method: 'PATCH',
        body: {
          name: $('#e-name').value.trim(),
          city: $('#e-city').value.trim(),
          role: $('#e-role').value,
          reputationPoints: Number($('#e-points').value),
          bio: $('#e-bio').value,
        },
      });
      toast('Профилът е обновен');
      openUser(id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if ($('#f-suspend'))
    $('#f-suspend').onclick = () => {
      openModal(
        'Спри профила временно',
        `
        <div class="hint">Човекът получава имейл с причината. Докато е спрян, не може да влиза, а офертите му се скриват.</div>
        <label class="field" style="margin-top:12px"><span>Причина (отива в имейла)</span>
          <textarea id="s-reason" placeholder="Напр.: Публикуване на неверни цени след предупреждение."></textarea></label>
        <label class="field"><span>Срок</span>
          <select id="s-days">
            <option value="1">1 ден</option>
            <option value="3">3 дни</option>
            <option value="7" selected>7 дни</option>
            <option value="30">30 дни</option>
            <option value="90">90 дни</option>
            <option value="">Безсрочно</option>
          </select></label>
        <label class="field"><span><input type="checkbox" id="s-hide" checked style="width:auto"> Скрий офертите му от приложението</span></label>
        <label class="field"><span><input type="checkbox" id="s-notify" checked style="width:auto"> Прати имейл с причината</span></label>
      `,
        [
          { id: 's-ok', label: 'Спри профила', cls: 'btn-warn' },
          { id: 's-cancel', label: 'Отказ', cls: 'btn-ghost' },
        ]
      );
      $('#s-cancel').onclick = closeModal;
      $('#s-ok').onclick = async () => {
        try {
          const res = await api(`/users/${id}/suspend`, {
            method: 'POST',
            body: {
              reason: $('#s-reason').value.trim(),
              days: $('#s-days').value ? Number($('#s-days').value) : undefined,
              hidePosts: $('#s-hide').checked,
              notify: $('#s-notify').checked,
            },
          });
          toast(`Профилът е спрян. Скрити оферти: ${res.hiddenPosts}. Имейл: ${res.mailSent ? 'пратен' : res.mailError ? 'грешка' : 'не е пращан'}`);
          openUser(id);
        } catch (e) {
          toast(e.message, 'error');
        }
      };
    };

  if ($('#f-resume'))
    $('#f-resume').onclick = async () => {
      try {
        const res = await api(`/users/${id}/resume`, { method: 'POST', body: { restorePosts: true } });
        toast(`Профилът е пуснат. Върнати оферти: ${res.restoredPosts}`);
        openUser(id);
      } catch (e) {
        toast(e.message, 'error');
      }
    };

  if ($('#f-mail'))
    $('#f-mail').onclick = () => {
      openModal(
        'Писмо до потребителя',
        `
        <label class="field"><span>Тема</span><input id="m-subject" value="Съобщение от екипа на SmartPrice"></label>
        <label class="field"><span>Съобщение</span><textarea id="m-body" placeholder="Напиши съобщението…"></textarea></label>
      `,
        [
          { id: 'm-send', label: 'Изпрати', cls: 'btn-primary' },
          { id: 'm-cancel', label: 'Отказ', cls: 'btn-ghost' },
        ]
      );
      $('#m-cancel').onclick = closeModal;
      $('#m-send').onclick = async () => {
        try {
          await api('/emails/send', {
            method: 'POST',
            body: { userId: id, subject: $('#m-subject').value.trim(), message: $('#m-body').value.trim() },
          });
          toast('Писмото е изпратено');
          closeModal();
        } catch (e) {
          toast(e.message, 'error');
        }
      };
    };

  if ($('#f-delete'))
    $('#f-delete').onclick = () => {
      openModal(
        'Изтрий профила',
        `
        <div class="hint warn">Това е необратимо от панела: профилът спира да влиза, офертите и коментарите му се махат от приложението. За потвърждение напиши имейла му.</div>
        <label class="field" style="margin-top:12px"><span>Имейл за потвърждение</span>
          <input id="d-confirm" placeholder="${esc(p.email)}"></label>
        <label class="field"><span>Причина (отива в имейла)</span><textarea id="d-reason"></textarea></label>
        <label class="field"><span><input type="checkbox" id="d-notify" checked style="width:auto"> Прати имейл с причината</span></label>
      `,
        [
          { id: 'd-ok', label: 'Изтрий', cls: 'btn-danger' },
          { id: 'd-cancel', label: 'Отказ', cls: 'btn-ghost' },
        ]
      );
      $('#d-cancel').onclick = closeModal;
      $('#d-ok').onclick = async () => {
        try {
          await api(`/users/${id}`, {
            method: 'DELETE',
            body: {
              reason: $('#d-reason').value.trim(),
              confirm: $('#d-confirm').value.trim(),
              notify: $('#d-notify').checked,
            },
          });
          toast('Профилът е изтрит');
          closeModal();
          render('users', true);
        } catch (e) {
          toast(e.message, 'error');
        }
      };
    };
}

/* ------------------------------------------------------------ оферти */

async function renderPosts(box, force) {
  const f = (cache.postsFilter = force
    ? { search: '', status: 'all', polarity: 'all', sellerType: 'all', offset: 0 }
    : cache.postsFilter || { search: '', status: 'all', polarity: 'all', sellerType: 'all', offset: 0 });

  box.innerHTML = `
    <div class="toolbar">
      <input class="grow" id="p-search" placeholder="Търси по ID (SP-…), заглавие, място, град или автор…" value="${esc(f.search)}">
      <select id="p-status">
        <option value="all">Всички статуси</option>
        <option value="published">Публични</option>
        <option value="hidden">Скрити</option>
        <option value="removed">Премахнати</option>
      </select>
      <select id="p-pol">
        <option value="all">Зелени и червени</option>
        <option value="green">🟢 Находки</option>
        <option value="red">🔴 Червени флагове</option>
      </select>
      <select id="p-seller">
        <option value="all">Всички продавачи</option>
        <option value="business">Магазини</option>
        <option value="private">Частни лица</option>
      </select>
      <button class="btn" id="p-go">Търси</button>
    </div>
    <div id="p-list"><div class="card"><span class="spinner"></span></div></div>`;

  $('#p-status').value = f.status;
  $('#p-pol').value = f.polarity;
  $('#p-seller').value = f.sellerType;

  const load = async () => {
    Object.assign(f, {
      search: $('#p-search').value.trim(),
      status: $('#p-status').value,
      polarity: $('#p-pol').value,
      sellerType: $('#p-seller').value,
    });
    const qs = new URLSearchParams({ ...f, limit: 50 });
    const data = await api(`/posts?${qs}`);
    $('#p-list').innerHTML = `
      <div class="dim" style="margin-bottom:8px">Намерени: <strong>${num(data.total)}</strong></div>
      <div class="table-wrap"><table>
        <thead><tr><th>ID</th><th>Оферта</th><th>Място</th><th>Цена</th><th>Автор</th><th>Любими</th><th>Статус</th><th></th></tr></thead>
        <tbody>
        ${
          data.items.length
            ? data.items
                .map(
                  (p) => `<tr>
              <td class="mono nowrap">${esc(p.public_code)}</td>
              <td>${esc(p.title)} ${p.seller_type === 'private' ? '<span class="pill pill-gold">частно лице</span>' : ''}</td>
              <td>${esc(p.place_name || '—')} <span class="dim">${esc(p.city || '')}</span><br>
                  <span class="dim mono" style="font-size:11.5px">${p.latitude && p.longitude ? `${Number(p.latitude).toFixed(4)}, ${Number(p.longitude).toFixed(4)}` : 'няма GPS'}</span></td>
              <td>${money(p.price)}</td>
              <td class="dim">${esc(p.author_handle)}</td>
              <td>${num(p.favorites_count)}</td>
              <td><span class="pill ${p.status === 'published' ? 'pill-green' : p.status === 'hidden' ? 'pill-gold' : 'pill-red'}">${esc(p.status)}</span></td>
              <td class="actions">
                <button class="btn btn-sm" data-post="${esc(p.id)}">Отвори</button>
                ${p.latitude && p.longitude ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${p.latitude},${p.longitude}">🗺</a>` : ''}
              </td>
            </tr>`
                )
                .join('')
            : '<tr><td colspan="8" class="empty">Няма намерени оферти</td></tr>'
        }
        </tbody></table></div>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn btn-sm" id="p-prev" ${f.offset === 0 ? 'disabled' : ''}>← Предишни</button>
        <button class="btn btn-sm" id="p-next" ${f.offset + 50 >= data.total ? 'disabled' : ''}>Следващи →</button>
      </div>`;
    $('#p-prev').onclick = () => {
      f.offset = Math.max(0, f.offset - 50);
      load();
    };
    $('#p-next').onclick = () => {
      f.offset += 50;
      load();
    };
    document.querySelectorAll('[data-post]').forEach((b) => {
      b.onclick = () => openPost(data.items.find((x) => x.id === b.dataset.post));
    });
  };

  $('#p-go').onclick = load;
  $('#p-search').onkeydown = (e) => {
    if (e.key === 'Enter') load();
  };
  await load();
}

function openPost(p) {
  if (!p) return;
  const body = `
    <div class="form-grid">
      <label class="field full"><span>Заглавие</span><input id="pp-title" value="${esc(p.title)}"></label>
      <label class="field"><span>Статус</span>
        <select id="pp-status">
          ${['published', 'hidden', 'removed'].map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></label>
      <label class="field"><span>Категория</span>
        <select id="pp-cat">
          ${['restaurants', 'hotels_airbnb', 'supermarket', 'cafes_bars', 'services_tech', 'other', 'private_sellers']
            .map((c) => `<option value="${c}" ${p.category === c ? 'selected' : ''}>${c}</option>`)
            .join('')}
        </select></label>
      <label class="field"><span>Тип продавач</span>
        <select id="pp-seller">
          <option value="business" ${p.seller_type !== 'private' ? 'selected' : ''}>Магазин / обект</option>
          <option value="private" ${p.seller_type === 'private' ? 'selected' : ''}>Частно лице</option>
        </select></label>
      <label class="field"><span>Цена (€)</span><input id="pp-price" type="number" step="0.01" value="${Number(p.price || 0)}"></label>
      <label class="field"><span>Град</span><input id="pp-city" value="${esc(p.city || '')}"></label>
      <label class="field"><span>Място</span><input id="pp-place" value="${esc(p.place_name || '')}"></label>
      <label class="field"><span>Адрес</span><input id="pp-address" value="${esc(p.address || '')}"></label>
      <label class="field"><span>GPS (ширина)</span><input id="pp-lat" type="number" step="0.000001" value="${p.latitude ?? ''}"></label>
      <label class="field"><span>GPS (дължина)</span><input id="pp-lng" type="number" step="0.000001" value="${p.longitude ?? ''}"></label>
      <label class="field full"><span>Коментар за частен продавач (къде и кога го намираш)</span><textarea id="pp-note">${esc(p.seller_note || '')}</textarea></label>
      <label class="field full"><span>Контакт на продавача</span><input id="pp-contact" value="${esc(p.seller_contact || '')}"></label>
    </div>
    <div class="hint" style="margin-top:12px">
      ID на офертата: <strong class="mono">${esc(p.public_code)}</strong> ·
      Автор: ${esc(p.author_handle)} (${esc(p.author_email)}) ·
      Създадена: ${dt(p.created_at)}
    </div>`;

  openModal(`Оферта ${p.public_code}`, body, [
    { id: 'pp-save', label: 'Запази', cls: 'btn-primary' },
    { id: 'pp-del', label: '🗑 Премахни', cls: 'btn-danger' },
    { id: 'pp-hard', label: 'Изтрий завинаги', cls: 'btn-danger' },
    { id: 'pp-cancel', label: 'Затвори', cls: 'btn-ghost' },
  ], true);

  $('#pp-cancel').onclick = closeModal;
  $('#pp-save').onclick = async () => {
    try {
      await api(`/posts/${p.id}`, {
        method: 'PATCH',
        body: {
          title: $('#pp-title').value.trim(),
          status: $('#pp-status').value,
          category: $('#pp-cat').value,
          sellerType: $('#pp-seller').value,
          pricePaid: Number($('#pp-price').value),
          city: $('#pp-city').value.trim(),
          placeName: $('#pp-place').value.trim(),
          address: $('#pp-address').value.trim() || null,
          latitude: $('#pp-lat').value ? Number($('#pp-lat').value) : null,
          longitude: $('#pp-lng').value ? Number($('#pp-lng').value) : null,
          sellerNote: $('#pp-note').value.trim() || null,
          sellerContact: $('#pp-contact').value.trim() || null,
        },
      });
      toast('Офертата е обновена');
      closeModal();
      render('posts', true);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#pp-del').onclick = async () => {
    try {
      await api(`/posts/${p.id}`, { method: 'DELETE' });
      toast('Офертата е премахната от приложението');
      closeModal();
      render('posts', true);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#pp-hard').onclick = () => {
    confirmAction({
      title: 'Изтриване завинаги',
      message: `Оферта <strong>${esc(p.public_code)}</strong> — „${esc(p.title)}“ ще бъде изтрита без връщане назад.`,
      details: [
        'Офертата, коментарите и реакциите към нея се махат от базата.',
        'Ако искаш само да я скриеш от приложението, използвай „Премахни“ (статус „премахната“).',
      ],
      confirmLabel: 'Изтрий завинаги',
      onConfirm: async () => {
        try {
          await api(`/posts/${p.id}?hard=true`, { method: 'DELETE' });
          toast('Офертата е изтрита завинаги');
          closeModal();
          render('posts', true);
        } catch (e) {
          toast(e.message, 'error');
        }
      },
    });
  };
}

/* ------------------------------------------------------------ томболи */

/** Качва снимка от панела и връща публичния ѝ адрес. */
async function uploadImage(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
    body: form,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: { message: text.slice(0, 200) } };
  }
  if (!res.ok) throw new Error(data?.error?.message || `Грешка ${res.status}`);
  return data.url;
}

const RAFFLE_STATUS = {
  draft: ['Чернова', 'pill-dim'],
  active: ['Събира участници', 'pill-green'],
  running: ['Нареждането е отворено', 'pill-cyan'],
  finished: ['Приключила', 'pill-dim'],
  cancelled: ['Анулирана', 'pill-red'],
};

async function renderRaffles(box) {
  const data = await api('/raffles');
  const items = data.items || [];

  box.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" id="r-new">+ Нова томбола</button>
      <span class="dim">Снимката на наградата се качва оттук — тя се вижда в приложението, точно над линка „Виж продукта“.
        <br>🛡️ Настройките <strong>„Защита срещу фалшиви акаунти“</strong> (различни дни, стаж на профила, ⏱ синхронен старт) са <strong>във формата на томболата</strong> — натисни „+ Нова томбола“ или „Редакция“ и скрол надолу.</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Томбола</th><th>Награда</th><th>Снимка</th><th>Срок</th><th>Участници</th><th>Статус</th><th></th></tr></thead>
      <tbody>
      ${
        items.length
          ? items
              .map((r) => {
                const [label, cls] = RAFFLE_STATUS[r.status] || [r.status, 'pill-dim'];
                const ends = r.endsAt ? new Date(r.endsAt) : null;
                const days = ends ? Math.max(0, Math.ceil((ends.getTime() - Date.now()) / 86400000)) : null;
                return `<tr>
              <td><strong>${esc(r.title)}</strong><div class="dim">минимум ${num(r.minParticipants)} · условие ${num(r.conditionPosts)} находки</div></td>
              <td>${esc(r.prize.title)}${r.prize.price ? `<div class="dim">${money(r.prize.price)}</div>` : ''}
                  ${r.prize.url ? `<a href="${esc(r.prize.url)}" target="_blank" rel="noopener">линк ↗</a>` : '<span class="dim">без линк</span>'}</td>
              <td>${r.prize.image ? `<img src="${esc(r.prize.image)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:10px;border:1px solid var(--line)">` : '<span class="pill pill-gold">няма</span>'}</td>
              <td class="dim nowrap">${r.endsAt ? dt(r.endsAt) : '—'}${days !== null ? `<div>${days} дни</div>` : ''}</td>
              <td>${num(r.qualifiedCount)}${r.winnerId ? `<div class="pill pill-green">има победител</div>` : ''}</td>
              <td><span class="pill ${cls}">${esc(label)}</span></td>
              <td class="actions">
                <button class="btn btn-sm" data-r-edit="${esc(r.id)}">Редакция</button>
                ${
                  r.status === 'active'
                    ? `<button class="btn btn-sm btn-ok" data-r-run="${esc(r.id)}">Пусни нареждането</button>`
                    : ''
                }
                ${
                  r.status === 'running'
                    ? `<button class="btn btn-sm btn-warn" data-r-draw="${esc(r.id)}">Разиграй</button>`
                    : ''
                }
                ${r.status === 'draft' ? `<button class="btn btn-sm btn-ok" data-r-activate="${esc(r.id)}">Активирай</button>` : ''}
                ${r.qualifiedCount > 0 ? `<button class="btn btn-sm" data-r-fraud="${esc(r.id)}">🔍 Провери за измами</button>` : ''}
                <button class="btn btn-sm btn-danger" data-r-del="${esc(r.id)}">Изтрий</button>
              </td>
            </tr>`;
              })
              .join('')
          : '<tr><td colspan="7" class="empty">Още няма томболи</td></tr>'
      }
      </tbody></table></div>`;

  const byId = (id) => items.find((x) => x.id === id);

  $('#r-new').onclick = () => raffleForm(null);

  document.querySelectorAll('[data-r-edit]').forEach((b) => {
    b.onclick = () => raffleForm(byId(b.dataset.rEdit));
  });
  document.querySelectorAll('[data-r-activate]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/raffles/${b.dataset.rActivate}/status`, { method: 'POST', body: { status: 'active' } });
        toast('Томболата е активна');
        render('raffles', true);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
  document.querySelectorAll('[data-r-run]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/raffles/${b.dataset.rRun}/status`, { method: 'POST', body: { status: 'running' } });
        toast('Нареждането е отворено');
        render('raffles', true);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
  document.querySelectorAll('[data-r-draw]').forEach((b) => {
    b.onclick = () => {
      const r = byId(b.dataset.rDraw);
      confirmAction({
        title: 'Разиграване на томболата',
        message: `Да разиграя ли сега: <strong>${esc(r ? r.title : 'томболата')}</strong>?`,
        details: [
          'Печели най-бързият, който е покрил условието и е наредил пъзела.',
          `Участници в момента: ${r ? num(r.qualifiedCount) : 0}.`,
          'След разиграването томболата става „приключила“ и резултатът се вижда от всички.',
        ],
        confirmLabel: 'Разиграй',
        danger: false,
        onConfirm: async () => {
          try {
            const res = await api(`/raffles/${b.dataset.rDraw}/draw`, { method: 'POST' });
            toast(res.winner ? 'Има победител' : res.message || 'Няма победител');
            closeModal();
            render('raffles', true);
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      });
    };
  });

  document.querySelectorAll('[data-r-del]').forEach((b) => {
    b.onclick = () => {
      const r = byId(b.dataset.rDel);
      confirmAction({
        title: 'Изтриване на томбола',
        message: `<strong>${esc(r ? r.title : '')}</strong> ще бъде изтрита <strong>завинаги</strong>.`,
        details: [
          `Участия, които се махат: ${r ? num(r.qualifiedCount) : 0}.`,
          'Класацията, историята и броят показвания на рекламата също се махат.',
          'Действието не може да се върне назад. Ако искаш само да я спреш, ползвай „Анулирай“ чрез статуса.',
        ],
        confirmLabel: 'Изтрий завинаги',
        onConfirm: async () => {
          try {
            const res = await api(`/raffles/${b.dataset.rDel}`, { method: 'DELETE' });
            const rm = res.removed || {};
            toast(`Изтрита: „${rm.title || ''}“ · махнати участия: ${rm.entries ?? 0}, събития: ${rm.events ?? 0}`);
            closeModal();
            render('raffles', true);
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      });
    };
  });

  document.querySelectorAll('[data-r-fraud]').forEach((b) => {
    b.onclick = () => fraudReport(byId(b.dataset.rFraud));
  });
}

/**
 * Проверка за злоупотреба: кой е съмнителен и защо.
 *
 * Показваме уликите, а не присъда — админът решава. Дисквалификацията тук
 * маха участника от класацията и от разиграването (drawWinner пропуска
 * дисквалифицираните), така че може спокойно да се направи ПРЕДИ тегленето.
 */
async function fraudReport(r) {
  if (!r) return;
  const data = await api(`/raffles/${r.id}/suspicious`);
  const items = data.items || [];
  const s = data.summary || {};

  const RISK = {
    high: ['Висок риск', 'pill-red'],
    medium: ['Среден риск', 'pill-gold'],
    low: ['Нисък риск', 'pill-dim'],
  };

  const rows = items.length
    ? items
        .map((e) => {
          const [label, cls] = RISK[e.risk] || [e.risk, 'pill-dim'];
          const flags = e.flags.length
            ? e.flags.map((f) => `<div class="dim" style="font-size:11.5px">• ${esc(f.label)}</div>`).join('')
            : '<span class="dim">—</span>';
          return `<tr>
            <td><strong>${esc(e.name)}</strong><div class="dim">${esc(e.handle)} · ${esc(e.email)}</div>
                <div class="dim" style="font-size:11.5px">${esc(e.city)} · профил на ${num(e.accountAgeDays)} дни${e.signupIp ? ` · IP ${esc(e.signupIp)}` : ''}</div></td>
            <td>${e.runTimeMs != null ? `${(e.runTimeMs / 1000).toFixed(2)} с` : '<span class="dim">не е играл</span>'}
                ${e.disqualified ? '<div class="pill pill-red">дисквалифициран</div>' : ''}</td>
            <td><span class="pill ${cls}">${esc(label)}</span><div class="dim" style="font-size:11px">точки: ${num(e.score)}</div></td>
            <td>${flags}</td>
            <td class="actions">
              ${
                e.disqualified
                  ? `<button class="btn btn-sm btn-ok" data-f-allow="${esc(e.userId)}">Върни го</button>`
                  : `<button class="btn btn-sm btn-danger" data-f-block="${esc(e.userId)}">Дисквалифицирай</button>`
              }
            </td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="5" class="empty">Няма участници още</td></tr>';

  const body = `
    <div class="hint" style="margin-bottom:12px">
      Участници: <strong>${num(s.total ?? 0)}</strong> ·
      висок риск: <strong>${num(s.high ?? 0)}</strong> ·
      среден: <strong>${num(s.medium ?? 0)}</strong> ·
      дисквалифицирани: <strong>${num(s.disqualified ?? 0)}</strong>
    </div>
    <div class="hint" style="margin-bottom:12px">
      Уликите идват само от базата (касови бележки, снимки, IP, възраст на профила) — нищо
      не се вярва на клиента. <strong>„Едно и също IP“ не е присъда</strong>: семейство на един
      Wi-Fi излиза с едно IP. Затова тежи малко, а съвпадаща бележка или снимка — тежи много.
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Участник</th><th>Време</th><th>Риск</th><th>Улики</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;

  openModal(`🔍 Проверка за измами — ${r.title}`, body, [{ id: 'f-close', label: 'Затвори', cls: 'btn-ghost' }], true);
  $('#f-close').onclick = closeModal;

  const act = async (userId, disqualified) => {
    try {
      await api(`/raffles/${r.id}/entries/${userId}/disqualify`, {
        method: 'POST',
        body: { disqualified, reason: 'Проверка за злоупотреба от админ панела' },
      });
      toast(disqualified ? 'Участникът е дисквалифициран' : 'Участникът е върнат');
      closeModal();
      fraudReport(r);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  document.querySelectorAll('[data-f-block]').forEach((b) => {
    b.onclick = () => act(b.dataset.fBlock, true);
  });
  document.querySelectorAll('[data-f-allow]').forEach((b) => {
    b.onclick = () => act(b.dataset.fAllow, false);
  });
}

/** Форма за нова/редакция на томбола, с качване на снимка на наградата. */
function raffleForm(r) {
  const isNew = !r;
  const ends = r?.endsAt ? new Date(r.endsAt) : null;
  const endsLocal = ends
    ? new Date(ends.getTime() - ends.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';
  const opens = r?.officialWindow?.opensAt ? new Date(r.officialWindow.opensAt) : null;
  const opensLocal = opens
    ? new Date(opens.getTime() - opens.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';

  const body = `
    <div class="form-grid">
      <label class="field full"><span>Заглавие на томболата</span><input id="rf-title" value="${esc(r?.title || '')}" placeholder="Томбола „Октомври“ — Air Fryer"></label>
      <label class="field full"><span>Описание (какво се прави)</span><textarea id="rf-desc">${esc(r?.description || '')}</textarea></label>

      <label class="field"><span>Награда (име на продукта)</span><input id="rf-prize" value="${esc(r?.prize?.title || '')}" placeholder="Air Fryer Philips XXL (7,2 л)"></label>
      <label class="field"><span>Цена на наградата (€)</span><input id="rf-price" type="number" step="0.01" value="${r?.prize?.price ?? ''}"></label>

      <label class="field full"><span>Линк към продукта („Виж продукта“)</span><input id="rf-url" value="${esc(r?.prize?.url || '')}" placeholder="https://..."></label>

      <div class="field full">
        <span>Снимка на наградата (показва се в приложението над линка)</span>
        <div style="display:flex;gap:12px;align-items:center;margin-top:6px">
          <img id="rf-preview" src="${esc(r?.prize?.image || '')}" alt=""
               style="width:96px;height:96px;object-fit:cover;border-radius:12px;border:1px solid var(--line);${r?.prize?.image ? '' : 'display:none'}">
          <div style="flex:1">
            <input type="file" id="rf-file" accept="image/jpeg,image/png,image/webp">
            <input id="rf-image" value="${esc(r?.prize?.image || '')}" placeholder="...или постави адрес на снимка" style="margin-top:8px">
          </div>
        </div>
      </div>

      <label class="field"><span>Условие: брой находки със снимка</span><input id="rf-cond" type="number" min="1" max="50" value="${r?.conditionPosts ?? 3}"></label>
      <label class="field"><span>Минимум участници</span><input id="rf-min" type="number" min="1" value="${r?.minParticipants ?? 5}"></label>
      <label class="field full"><span>Краен срок</span><input id="rf-ends" type="datetime-local" value="${endsLocal}"></label>

      <div class="field full" style="border-top:1px solid var(--line);padding-top:14px;margin-top:4px">
        <strong>🛡️ Защита срещу фалшиви акаунти</strong>
        <div class="dim" style="margin-top:4px;font-size:12px">
          Тези настройки решават дали един човек с няколко профила може да участва. По-строгите стойности
          значат по-малко участници, но по-честна томбола.
        </div>
      </div>
      <label class="field"><span>Находките от поне колко различни дни</span><input id="rf-days" type="number" min="1" max="30" value="${r?.conditionDistinctDays ?? 2}"></label>
      <label class="field"><span>Профилът да е на поне (дни)</span><input id="rf-age" type="number" min="0" max="365" value="${r?.minAccountAgeDays ?? 7}"></label>
      <label class="field"><span>Имейлът потвърден от поне (дни)</span><input id="rf-vage" type="number" min="0" max="365" value="${r?.minVerifiedAgeDays ?? 3}"></label>
      <label class="field"><span>Прозорец за игра (минути)</span><input id="rf-window" type="number" min="1" max="1440" value="${r?.officialWindow?.synced ? '' : ''}${r?.officialWindowMin ?? 15}"></label>
      <label class="field full"><span>⏱ Синхронен старт — часът, в който ВСИЧКИ играят</span>
        <input id="rf-opens" type="datetime-local" value="${opensLocal}">
        <div class="dim" style="font-size:11.5px;margin-top:6px">
          Остави празно, ако няма да има синхронен старт. С час: всички играят едновременно в
          прозореца по-горе — така човек с 5 профила пак има само един чифт ръце и не може да
          научи дъската с втория профил. <strong>Това е най-силната защита.</strong>
        </div>
      </label>
    </div>
    ${isNew ? '' : `<div class="hint" style="margin-top:12px">Статус: <strong>${esc(r.status)}</strong> · участници: ${num(r.qualifiedCount)}</div>`}`;

  openModal(isNew ? 'Нова томбола' : 'Редакция на томбола', body, [
    { id: 'rf-save', label: isNew ? 'Създай' : 'Запази', cls: 'btn-primary' },
    ...(isNew ? [] : [{ id: 'rf-delete', label: '🗑 Изтрий томболата', cls: 'btn-danger' }]),
    { id: 'rf-cancel', label: 'Отказ', cls: 'btn-ghost' },
  ], true);

  $('#rf-cancel').onclick = closeModal;

  if ($('#rf-delete')) {
    $('#rf-delete').onclick = () => {
      confirmAction({
        title: 'Изтриване на томбола',
        message: `<strong>${esc(r.title)}</strong> ще бъде изтрита <strong>завинаги</strong>.`,
        details: [
          `Участия, които се махат: ${num(r.qualifiedCount)}.`,
          'Класацията, историята и броят показвания на рекламата също се махат.',
          'Действието не може да се върне назад.',
        ],
        confirmLabel: 'Изтрий завинаги',
        onConfirm: async () => {
          try {
            const res = await api(`/raffles/${r.id}`, { method: 'DELETE' });
            const rm = res.removed || {};
            toast(`Изтрита: „${rm.title || ''}“ · махнати участия: ${rm.entries ?? 0}`);
            closeModal();
            render('raffles', true);
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      });
    };
  }

  $('#rf-file').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      toast('Качвам снимката…', 'warn');
      const url = await uploadImage(file);
      $('#rf-image').value = url;
      const prev = $('#rf-preview');
      prev.src = url;
      prev.style.display = '';
      toast('Снимката е качена');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  $('#rf-image').oninput = (e) => {
    const prev = $('#rf-preview');
    if (e.target.value) {
      prev.src = e.target.value;
      prev.style.display = '';
    } else {
      prev.style.display = 'none';
    }
  };

  $('#rf-save').onclick = async () => {
    const payload = {
      title: $('#rf-title').value.trim(),
      description: $('#rf-desc').value.trim(),
      prizeTitle: $('#rf-prize').value.trim(),
      prizeUrl: $('#rf-url').value.trim() || undefined,
      prizeImageUrl: $('#rf-image').value.trim() || undefined,
      prizePrice: $('#rf-price').value ? Number($('#rf-price').value) : undefined,
      conditionPosts: Number($('#rf-cond').value) || 3,
      minParticipants: Number($('#rf-min').value) || 5,
      conditionDistinctDays: Number($('#rf-days').value) || 1,
      minAccountAgeDays: Number($('#rf-age').value) || 0,
      minVerifiedAgeDays: Number($('#rf-vage').value) || 0,
      officialWindowMin: Number($('#rf-window').value) || 15,
      endsAt: $('#rf-ends').value ? new Date($('#rf-ends').value).toISOString() : undefined,
    };
    const opensValue = $('#rf-opens').value;
    payload.officialOpensAt = opensValue ? new Date(opensValue).toISOString() : undefined;
    try {
      if (isNew) {
        if (!payload.endsAt) throw new Error('Посочи краен срок.');
        await api('/raffles', { method: 'POST', body: { ...payload, activate: true } });
        toast('Томболата е създадена и активна');
      } else {
        await api(`/raffles/${r.id}`, { method: 'PATCH', body: payload });
        toast('Томболата е обновена');
      }
      closeModal();
      render('raffles', true);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
}

/* --------------------------------------------------------- коментари */

async function renderComments(box, force) {
  const f = (cache.commentsFilter = force ? { search: '', status: 'all', offset: 0 } : cache.commentsFilter || { search: '', status: 'all', offset: 0 });
  box.innerHTML = `
    <div class="toolbar">
      <input class="grow" id="c-search" placeholder="Търси по текст, автор или ID на оферта…" value="${esc(f.search)}">
      <select id="c-status">
        <option value="all">Всички</option>
        <option value="published">Публични</option>
        <option value="hidden">Скрити</option>
        <option value="removed">Премахнати</option>
      </select>
      <button class="btn" id="c-go">Търси</button>
    </div>
    <div id="c-list"><div class="card"><span class="spinner"></span></div></div>`;
  $('#c-status').value = f.status;

  const load = async () => {
    Object.assign(f, { search: $('#c-search').value.trim(), status: $('#c-status').value });
    const data = await api(`/comments?${new URLSearchParams({ ...f, limit: 50 })}`);
    $('#c-list').innerHTML = `
      <div class="dim" style="margin-bottom:8px">Намерени: <strong>${num(data.total)}</strong></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Коментар</th><th>Автор</th><th>Оферта</th><th>Харесвания</th><th>Статус</th><th></th></tr></thead>
        <tbody>
        ${
          data.items.length
            ? data.items
                .map(
                  (c) => `<tr>
              <td style="max-width:380px">${esc(c.body).slice(0, 180)}${c.body.length > 180 ? '…' : ''}
                  <div class="dim">${ago(c.created_at)}</div></td>
              <td>${esc(c.author_handle)}<br><span class="dim" style="font-size:11.5px">${esc(c.author_email)}</span></td>
              <td class="mono">${esc(c.public_code || '—')}</td>
              <td>${num(c.likes_count)}</td>
              <td><span class="pill ${c.status === 'published' ? 'pill-green' : c.status === 'hidden' ? 'pill-gold' : 'pill-red'}">${esc(c.status)}</span></td>
              <td class="actions">
                <button class="btn btn-sm" data-c-hide="${esc(c.id)}">Скрий</button>
                <button class="btn btn-sm btn-ok" data-c-show="${esc(c.id)}">Покажи</button>
                <button class="btn btn-sm btn-danger" data-c-del="${esc(c.id)}">Изтрий</button>
              </td>
            </tr>`
                )
                .join('')
            : '<tr><td colspan="6" class="empty">Няма коментари</td></tr>'
        }
        </tbody></table></div>`;

    const setStatus = async (id, status) => {
      try {
        await api(`/comments/${id}`, { method: 'PATCH', body: { status } });
        toast('Готово');
        load();
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    document.querySelectorAll('[data-c-hide]').forEach((b) => (b.onclick = () => setStatus(b.dataset.cHide, 'hidden')));
    document.querySelectorAll('[data-c-show]').forEach((b) => (b.onclick = () => setStatus(b.dataset.cShow, 'published')));
    document.querySelectorAll('[data-c-del]').forEach(
      (b) =>
        (b.onclick = () =>
          confirmAction({
            title: 'Изтриване на коментар',
            message: 'Коментарът ще бъде изтрит завинаги.',
            details: ['Действието не може да се върне назад. Ако искаш само да го скриеш, ползвай „Скрий“.'],
            confirmLabel: 'Изтрий',
            onConfirm: async () => {
              try {
                await api(`/comments/${b.dataset.cDel}`, { method: 'DELETE' });
                toast('Коментарът е изтрит');
                closeModal();
                load();
              } catch (e) {
                toast(e.message, 'error');
              }
            },
          }))
    );
  };

  $('#c-go').onclick = load;
  $('#c-search').onkeydown = (e) => {
    if (e.key === 'Enter') load();
  };
  await load();
}

/* ----------------------------------------------------------- сигнали */

async function renderReports(box, force) {
  const f = (cache.reportsFilter = force ? { status: 'all' } : cache.reportsFilter || { status: 'all' });
  box.innerHTML = `
    <div class="toolbar">
      <select id="r-status">
        <option value="all">Всички</option>
        <option value="open">Отворени</option>
        <option value="reviewed">Прегледани</option>
        <option value="dismissed">Отхвърлени</option>
        <option value="actioned">Действано</option>
      </select>
      <button class="btn" id="r-go">Покажи</button>
    </div>
    <div id="r-list"><div class="card"><span class="spinner"></span></div></div>`;
  $('#r-status').value = f.status;

  const load = async () => {
    f.status = $('#r-status').value;
    const data = await api(`/reports?status=${f.status}&limit=50`);
    $('#r-list').innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Причина</th><th>Обект</th><th>От</th><th>Кога</th><th>Статус</th><th></th></tr></thead>
        <tbody>
        ${
          data.items.length
            ? data.items
                .map(
                  (r) => `<tr>
              <td>${esc(r.reason)}<div class="dim">${esc(r.details || '')}</div></td>
              <td>${r.post_id ? `<span class="mono">${esc(r.public_code || '')}</span> ${esc(r.post_title || '')}` : esc(r.comment_body || 'коментар')}</td>
              <td class="dim">${esc(r.reporter_handle)}</td>
              <td class="dim nowrap">${ago(r.created_at)}</td>
              <td><span class="pill ${r.status === 'open' ? 'pill-gold' : 'pill-dim'}">${esc(r.status)}</span></td>
              <td class="actions">
                ${['reviewed', 'dismissed', 'actioned']
                  .map((s) => `<button class="btn btn-sm" data-r="${esc(r.id)}" data-s="${s}">${s}</button>`)
                  .join('')}
              </td>
            </tr>`
                )
                .join('')
            : '<tr><td colspan="6" class="empty">Няма сигнали</td></tr>'
        }
        </tbody></table></div>`;
    document.querySelectorAll('[data-r]').forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            await api(`/reports/${b.dataset.r}`, { method: 'PATCH', body: { status: b.dataset.s } });
            toast('Сигналът е обновен');
            load();
          } catch (e) {
            toast(e.message, 'error');
          }
        })
    );
  };
  $('#r-go').onclick = load;
  await load();
}

/* -------------------------------------------------------- категории */

async function renderCategories(box) {
  const data = await api('/categories');
  box.innerHTML = `
    <div class="hint">Етикетите и думите за търсене важат веднага — търсенето в приложението ги ползва.</div>
    <div class="grid" style="margin-top:14px">
      ${data.items
        .map(
          (c) => `<div class="card">
          <div class="card-title">${esc(c.emoji)} ${esc(c.title)} <span class="pill pill-dim">${num(c.posts)} оферти</span></div>
          <div class="form-grid">
            <label class="field"><span>Етикет</span><input id="cat-title-${esc(c.id)}" value="${esc(c.title)}"></label>
            <label class="field"><span>Емоджи</span><input id="cat-emoji-${esc(c.id)}" value="${esc(c.emoji)}"></label>
            <label class="field"><span>Ред</span><input id="cat-sort-${esc(c.id)}" type="number" value="${Number(c.sort_order)}"></label>
            <label class="field full"><span>Думи за търсене (синоними)</span><textarea id="cat-syn-${esc(c.id)}">${esc(c.synonyms)}</textarea></label>
          </div>
          <button class="btn btn-primary btn-sm" data-cat="${esc(c.id)}">Запази</button>
        </div>`
        )
        .join('')}
    </div>`;
  document.querySelectorAll('[data-cat]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.cat;
      try {
        await api(`/categories/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: {
            title: $(`#cat-title-${CSS.escape(id)}`).value.trim(),
            emoji: $(`#cat-emoji-${CSS.escape(id)}`).value.trim(),
            synonyms: $(`#cat-syn-${CSS.escape(id)}`).value.trim(),
            sortOrder: Number($(`#cat-sort-${CSS.escape(id)}`).value),
          },
        });
        toast('Категорията е обновена');
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
}

/* ------------------------------------------------------------ покани */

async function renderReferrals(box) {
  const [data, stats] = await Promise.all([api('/referrals?limit=50'), cache.stats || api('/stats')]);
  cache.stats = stats;
  box.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:14px">
      <div class="card kpi"><div class="kpi-label">Всички покани</div><div class="kpi-value">${num(data.summary.total)}</div></div>
      <div class="card kpi"><div class="kpi-label">Получили точки</div><div class="kpi-value green">${num(data.summary.rewarded)}</div></div>
      <div class="card kpi"><div class="kpi-label">Чакащи</div><div class="kpi-value gold">${num(data.summary.pending)}</div></div>
      <div class="card kpi"><div class="kpi-label">Анулирани</div><div class="kpi-value red">${num(data.summary.void)}</div></div>
    </div>

    <div class="grid grid-2" style="margin-bottom:14px">
      <div class="card">
        <div class="card-title">🥇 Най-добри поканващи</div>
        ${
          stats.topReferrers.length
            ? `<div class="table-wrap"><table><thead><tr><th>Профил</th><th>Код</th><th>Поканил</th><th>Наградени</th></tr></thead><tbody>
              ${stats.topReferrers
                .map(
                  (r) => `<tr><td>${esc(r.name)} <span class="dim mono">${esc(r.handle)}</span></td>
                  <td class="mono">${esc(r.code)}</td><td>${num(r.invited)}</td><td>${num(r.rewarded)}</td></tr>`
                )
                .join('')}</tbody></table></div>`
            : '<div class="empty">Още няма покани</div>'
        }
      </div>
      <div class="card">
        <div class="card-title">🔗 Последни покани</div>
        <div class="table-wrap"><table><thead><tr><th>Поканил</th><th>Поканен</th><th>Статус</th><th>Кога</th></tr></thead><tbody>
        ${
          data.items.length
            ? data.items
                .map(
                  (r) => `<tr><td class="mono">${esc(r.referrer_handle)}</td><td class="mono">${esc(r.referred_handle)}</td>
              <td><span class="pill ${r.status === 'rewarded' ? 'pill-green' : r.status === 'pending' ? 'pill-gold' : 'pill-dim'}">${esc(r.status)}</span></td>
              <td class="dim nowrap">${ago(r.created_at)}</td></tr>`
                )
                .join('')
            : '<tr><td colspan="4" class="empty">Още няма покани</td></tr>'
        }
        </tbody></table></div>
      </div>
    </div>`;
}

/* ----------------------------------------------------------- любими */

async function renderFavorites(box) {
  const data = await api('/favorites?limit=50');
  box.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:14px">
      <div class="card kpi"><div class="kpi-label">Всички любими</div><div class="kpi-value">${num(data.summary.total)}</div></div>
      <div class="card kpi"><div class="kpi-label">Хора с любими</div><div class="kpi-value cyan">${num(data.summary.users)}</div></div>
      <div class="card kpi"><div class="kpi-label">С лична бележка</div><div class="kpi-value gold">${num(data.summary.with_note)}</div></div>
    </div>
    <div class="card">
      <div class="card-title">⭐ Най-пазени оферти (с локация)</div>
      <div class="table-wrap"><table>
        <thead><tr><th>ID</th><th>Оферта</th><th>Място</th><th>GPS</th><th>Любими</th><th></th></tr></thead>
        <tbody>
        ${
          data.items.length
            ? data.items
                .map(
                  (f) => `<tr>
              <td class="mono">${esc(f.public_code)}</td>
              <td>${esc(f.title)}</td>
              <td>${esc(f.place_name || '—')} <span class="dim">${esc(f.city || '')}</span></td>
              <td class="mono dim">${f.latitude && f.longitude ? `${Number(f.latitude).toFixed(4)}, ${Number(f.longitude).toFixed(4)}` : '—'}</td>
              <td>${num(f.favorites)}</td>
              <td>${f.latitude && f.longitude ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${f.latitude},${f.longitude}">🗺 Карта</a>` : ''}</td>
            </tr>`
                )
                .join('')
            : '<tr><td colspan="6" class="empty">Още няма любими</td></tr>'
        }
        </tbody></table></div>
    </div>`;
}

/* --------------------------------------------------------- сигурност */

async function renderSecurity(box, force) {
  const f = (cache.securityFilter = force ? { onlyOpen: false } : cache.securityFilter || { onlyOpen: false });
  const data = await api(`/security?onlyOpen=${f.onlyOpen}&limit=50`);
  box.innerHTML = `
    <div class="toolbar">
      <label class="dim"><input type="checkbox" id="sec-open" style="width:auto" ${f.onlyOpen ? 'checked' : ''}> само нерешени</label>
      <button class="btn" id="sec-scan">🔍 Пусни проверка сега</button>
      <button class="btn" id="sec-test">✉️ Тестово писмо</button>
      <span class="dim">Проверката върви автоматично на всеки 5 минути. Алармите отиват на имейла за аларми.</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Степен</th><th>Какво</th><th>Подробности</th><th>Кога</th><th>Имейл</th><th></th></tr></thead>
      <tbody>
      ${
        data.items.length
          ? data.items
              .map(
                (s) => `<tr>
            <td><span class="pill ${s.severity === 'critical' ? 'pill-red' : s.severity === 'warning' ? 'pill-gold' : 'pill-cyan'}">${esc(s.severity)}</span></td>
            <td>${esc(s.title)}<div class="dim mono">${esc(s.kind)}</div></td>
            <td class="dim" style="max-width:420px">${esc(
              Object.entries(s.details || {})
                .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                .join(' · ')
            )}</td>
            <td class="dim nowrap">${ago(s.created_at)}</td>
            <td>${s.alerted_at ? '<span class="pill pill-green">пратен</span>' : '<span class="pill pill-dim">—</span>'}</td>
            <td class="actions">${s.resolved_at ? '<span class="pill pill-dim">решено</span>' : `<button class="btn btn-sm" data-sec="${s.id}">Решено</button>`}</td>
          </tr>`
              )
              .join('')
          : '<tr><td colspan="6" class="empty">Няма засечени аномалии 👍</td></tr>'
      }
      </tbody></table></div>`;

  $('#sec-open').onchange = (e) => {
    f.onlyOpen = e.target.checked;
    render('security');
  };
  $('#sec-scan').onclick = async () => {
    try {
      const res = await api('/security/scan', { method: 'POST' });
      toast(`Проверката намери ${res.found} събития, пратени имейли: ${res.alerted}`);
      render('security', true);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#sec-test').onclick = async () => {
    try {
      const res = await api('/security/test-alert', { method: 'POST' });
      toast(`Тестово писмо до ${res.to}`);
      render('security', true);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  document.querySelectorAll('[data-sec]').forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api(`/security/${b.dataset.sec}/resolve`, { method: 'POST' });
          toast('Отбелязано като решено');
          render('security', true);
        } catch (e) {
          toast(e.message, 'error');
        }
      })
  );
}

/* ------------------------------------------------------------ имейли */

async function renderEmails(box) {
  const data = await api('/emails?limit=50');
  box.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="card-title">✉️ Ръчно писмо</div>
      <div class="form-grid">
        <label class="field"><span>До имейл</span><input id="em-to" placeholder="ime@example.com"></label>
        <label class="field"><span>Тема</span><input id="em-subject" value="Съобщение от екипа на SmartPrice"></label>
        <label class="field full"><span>Съобщение</span><textarea id="em-body"></textarea></label>
      </div>
      <button class="btn btn-primary" id="em-send">Изпрати</button>
    </div>
    <div class="card">
      <div class="card-title">📤 Изпратени писма</div>
      <div class="table-wrap"><table>
        <thead><tr><th>До</th><th>Тема</th><th>Вид</th><th>Статус</th><th>Кога</th></tr></thead>
        <tbody>
        ${
          data.items.length
            ? data.items
                .map(
                  (m) => `<tr>
              <td class="mono" style="font-size:12.5px">${esc(m.to_email)}</td>
              <td>${esc(m.subject)}</td>
              <td class="dim">${esc(m.kind)}</td>
              <td>${m.status === 'sent' ? '<span class="pill pill-green">пратен</span>' : `<span class="pill pill-red">${esc(m.status)}</span>`}</td>
              <td class="dim nowrap">${ago(m.created_at)}</td>
            </tr>`
                )
                .join('')
            : '<tr><td colspan="5" class="empty">Още няма писма</td></tr>'
        }
        </tbody></table></div>
    </div>`;
  $('#em-send').onclick = async () => {
    try {
      await api('/emails/send', {
        method: 'POST',
        body: { to: $('#em-to').value.trim(), subject: $('#em-subject').value.trim(), message: $('#em-body').value.trim() },
      });
      toast('Писмото е изпратено');
      render('emails');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
}

/* ------------------------------------------------------------ дневник */

async function renderAudit(box) {
  const data = await api('/audit?limit=100');
  box.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Кога</th><th>Админ</th><th>Действие</th><th>Обект</th><th>Подробности</th><th>IP</th></tr></thead>
      <tbody>
      ${
        data.items.length
          ? data.items
              .map(
                (a) => `<tr>
            <td class="dim nowrap">${dt(a.created_at)}</td>
            <td class="mono" style="font-size:12.5px">${esc(a.admin_email)}</td>
            <td><span class="pill pill-cyan">${esc(a.action)}</span></td>
            <td>${esc(a.target_type || '')} <span class="mono dim">${esc(a.target_label || a.target_id || '')}</span></td>
            <td class="dim" style="max-width:380px">${esc(JSON.stringify(a.details || {}))}</td>
            <td class="mono dim">${esc(a.ip || '—')}</td>
          </tr>`
              )
              .join('')
          : '<tr><td colspan="6" class="empty">Още няма действия</td></tr>'
      }
      </tbody></table></div>`;
}

/* ------------------------------------------------------------ прозорец */

function openModal(title, bodyHtml, buttons = [], wide = false) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-box').classList.toggle('wide', Boolean(wide));
  const foot = $('#modal-foot');
  foot.innerHTML = '';
  buttons.forEach((b) => {
    const el = document.createElement('button');
    el.className = `btn ${b.cls || ''}`;
    el.id = b.id;
    el.textContent = b.label;
    if (b.onClick) el.onclick = b.onClick;
    foot.appendChild(el);
  });
  $('#modal').hidden = false;
  // В модалите също има полета с избор — подменяме и тях.
  enhanceSelects();
}

function closeModal() {
  $('#modal').hidden = true;
  $('#modal-body').innerHTML = '';
  $('#modal-foot').innerHTML = '';
}

/**
 * Потвърждение в стила на панела — вместо браузърния popup (confirm()).
 * `danger: true` прави бутона червен и слага предупредителен блок.
 */
function confirmAction({ title, message, details = [], confirmLabel = 'Потвърди', danger = true, onConfirm }) {
  const body = `
    <div class="hint ${danger ? 'warn' : ''}">${message}</div>
    ${
      details.length
        ? `<ul style="margin:14px 0 0 0;padding-left:20px;color:var(--muted);font-size:13.5px;line-height:1.75">
             ${details.map((d) => `<li>${d}</li>`).join('')}
           </ul>`
        : ''
    }`;

  openModal(title, body, [
    { id: 'cf-ok', label: confirmLabel, cls: danger ? 'btn-danger-solid' : 'btn-primary' },
    { id: 'cf-cancel', label: 'Отказ', cls: 'btn-ghost' },
  ]);

  $('#cf-cancel').onclick = closeModal;
  $('#cf-ok').onclick = async () => {
    const btn = $('#cf-ok');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Изпълнявам…';
    try {
      await onConfirm();
    } finally {
      if (document.body.contains(btn)) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  };
}

$('#modal-close').onclick = closeModal;
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
});

/* ------------------------------------------- красиви падащи менюта (select) */

/**
 * Заменя нативните <select> с наш бутон + наш списък.
 *
 * Нативният елемент остава в страницата (скрит), защото целият код чете
 * `$('#id').value` и слага `.onchange`. Нашият списък само променя стойността
 * му и пуска събитие `change` — тоест логиката работи без промяна, но човек
 * вижда тъмно меню в стила на панела, а не системния браузърен списък.
 */
function enhanceSelects() {
  document.querySelectorAll('select:not([data-enhanced])').forEach((sel) => {
    sel.dataset.enhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'sel';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('sel-native');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sel-btn';

    const labelEl = document.createElement('span');
    const caret = document.createElement('span');
    caret.className = 'sel-caret';
    caret.textContent = '▾';
    btn.appendChild(labelEl);
    btn.appendChild(caret);

    const menu = document.createElement('div');
    menu.className = 'sel-menu';
    menu.hidden = true;

    const syncLabel = () => {
      const opt = sel.options[sel.selectedIndex];
      labelEl.textContent = opt ? opt.textContent : '';
      btn.disabled = sel.disabled;
      Array.from(menu.children).forEach((item, i) => {
        item.classList.toggle('on', i === sel.selectedIndex);
      });
    };

    const buildItems = () => {
      menu.innerHTML = '';
      Array.from(sel.options).forEach((opt, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'sel-item';
        item.textContent = opt.textContent;
        item.onclick = (e) => {
          e.stopPropagation();
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          syncLabel();
          menu.hidden = true;
        };
        menu.appendChild(item);
      });
      syncLabel();
    };

    btn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      document.querySelectorAll('.sel-menu').forEach((m) => (m.hidden = true));
      if (willOpen) {
        // Ако под бутона няма място (например в модал), менюто се отваря нагоре.
        const rect = btn.getBoundingClientRect();
        menu.classList.toggle('up', rect.bottom + 320 > window.innerHeight && rect.top > 320);
      }
      menu.hidden = !willOpen;
    };

    // Кодът слага стойност програмно (напр. филтрите) — да не изостава надписът.
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', {
      configurable: true,
      get() {
        return proto.get.call(sel);
      },
      set(v) {
        proto.set.call(sel, v);
        syncLabel();
      },
    });

    sel.addEventListener('change', syncLabel);

    // Ако списъкът с опции се смени по-късно (рядко), презареждаме редовете.
    const mo = new MutationObserver(() => buildItems());
    mo.observe(sel, { childList: true });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    buildItems();
  });

  // Същият принцип и за полетата с дата и час (нативният календар също е
  // браузърен попъп) — виж enhanceDateInputs по-долу.
  enhanceDateInputs();
}

/* ------------------------------------------- красив избор на дата и час */

const DT_MONTHS = [
  'януари', 'февруари', 'март', 'април', 'май', 'юни',
  'юли', 'август', 'септември', 'октомври', 'ноември', 'декември',
];
const DT_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

const dtPad = (x) => String(x).padStart(2, '0');
const dtText = (d) =>
  `${dtPad(d.getDate())}.${dtPad(d.getMonth() + 1)}.${d.getFullYear()}, ${dtPad(d.getHours())}:${dtPad(d.getMinutes())}`;
const dtValue = (d) =>
  `${d.getFullYear()}-${dtPad(d.getMonth() + 1)}-${dtPad(d.getDate())}T${dtPad(d.getHours())}:${dtPad(d.getMinutes())}`;

/**
 * Заменя нативния `datetime-local` с наш календар в стила на панела.
 * Нативният input остава скрит и пази стойността — кодът чете `$('#rf-ends').value`
 * както преди.
 */
function enhanceDateInputs() {
  document.querySelectorAll('input[type="datetime-local"]:not([data-enhanced])').forEach((inp) => {
    inp.dataset.enhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'sel';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    inp.classList.add('sel-native');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sel-btn';
    const labelEl = document.createElement('span');
    const caret = document.createElement('span');
    caret.className = 'sel-caret';
    caret.textContent = '🗓';
    btn.appendChild(labelEl);
    btn.appendChild(caret);

    const pop = document.createElement('div');
    pop.className = 'sel-menu dt-pop';
    pop.hidden = true;

    let view = inp.value ? new Date(inp.value) : new Date();

    const syncLabel = () => {
      labelEl.textContent = inp.value ? dtText(new Date(inp.value)) : 'Избери дата и час';
    };

    const setValue = (d) => {
      inp.value = dtValue(d);
      syncLabel();
    };

    const renderPop = () => {
      const y = view.getFullYear();
      const m = view.getMonth();
      const startIdx = (new Date(y, m, 1).getDay() + 6) % 7; // понеделник = 0
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const today = new Date();
      const sel = inp.value ? new Date(inp.value) : null;

      let cells = '';
      for (let i = 0; i < startIdx; i += 1) cells += '<span class="dt-day off"></span>';
      for (let d = 1; d <= daysInMonth; d += 1) {
        const isSel = sel && sel.getFullYear() === y && sel.getMonth() === m && sel.getDate() === d;
        const isToday =
          today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
        cells += `<button type="button" class="dt-day${isSel ? ' on' : ''}${
          isToday ? ' today' : ''
        }" data-day="${d}">${d}</button>`;
      }

      const hh = sel ? sel.getHours() : 20;
      const mm = sel ? sel.getMinutes() : 0;

      pop.innerHTML = `
        <div class="dt-head">
          <button type="button" class="dt-nav" data-nav="-1">‹</button>
          <strong>${DT_MONTHS[m]} ${y}</strong>
          <button type="button" class="dt-nav" data-nav="1">›</button>
        </div>
        <div class="dt-wd">${DT_WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="dt-grid">${cells}</div>
        <div class="dt-time">
          <span class="dim">Час</span>
          <button type="button" class="dt-step" data-h="-1">−</button>
          <strong>${dtPad(hh)}</strong>
          <button type="button" class="dt-step" data-h="1">+</button>
          <span class="dim" style="margin-left:10px">Мин</span>
          <button type="button" class="dt-step" data-m="-15">−</button>
          <strong>${dtPad(mm)}</strong>
          <button type="button" class="dt-step" data-m="15">+</button>
        </div>
        <div class="dt-foot">
          <button type="button" class="btn btn-sm" data-quick="today">Днес 20:00</button>
          <button type="button" class="btn btn-sm" data-quick="week">След 7 дни</button>
          <button type="button" class="btn btn-sm btn-primary" data-quick="done">Готово</button>
        </div>`;

      pop.querySelectorAll('[data-nav]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          view = new Date(y, m + Number(b.dataset.nav), 1);
          renderPop();
        };
      });
      pop.querySelectorAll('.dt-day[data-day]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const base = sel ? new Date(sel) : new Date();
          setValue(new Date(y, m, Number(b.dataset.day), base.getHours(), base.getMinutes()));
          renderPop();
        };
      });
      pop.querySelectorAll('[data-h]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const d = sel ? new Date(sel) : new Date();
          d.setHours(d.getHours() + Number(b.dataset.h));
          setValue(d);
          renderPop();
        };
      });
      pop.querySelectorAll('[data-m]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const d = sel ? new Date(sel) : new Date();
          d.setMinutes(d.getMinutes() + Number(b.dataset.m));
          setValue(d);
          renderPop();
        };
      });
      pop.querySelectorAll('[data-quick]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const q = b.dataset.quick;
          if (q === 'done') {
            pop.hidden = true;
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
          const d = new Date();
          if (q === 'week') d.setDate(d.getDate() + 7);
          d.setHours(20, 0, 0, 0);
          setValue(d);
          renderPop();
        };
      });
    };

    btn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = pop.hidden;
      document.querySelectorAll('.sel-menu').forEach((m) => (m.hidden = true));
      if (willOpen) {
        if (inp.value) view = new Date(inp.value);
        // Календарят е висок — ако под бутона няма място, отваряме го нагоре.
        const rect = btn.getBoundingClientRect();
        pop.classList.toggle('up', rect.bottom + 430 > window.innerHeight && rect.top > 430);
        renderPop();
        pop.hidden = false;
      }
    };

    wrap.appendChild(btn);
    wrap.appendChild(pop);
    syncLabel();
  });
}

document.addEventListener('click', () => {
  document.querySelectorAll('.sel-menu').forEach((m) => (m.hidden = true));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.sel-menu').forEach((m) => (m.hidden = true));
});

new MutationObserver(() => {
  setTimeout(enhanceSelects, 0);
}).observe(document.body, { childList: true, subtree: true });

enhanceSelects();

/* --------------------------------------------------------------- старт */

(async () => {
  if (!state.token) {
    $('#login').hidden = false;
    return;
  }
  try {
    await showApp();
  } catch {
    logout(true);
  }
})();