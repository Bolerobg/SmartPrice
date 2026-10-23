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

  const body =
    options.body === undefined || options.body === null
      ? undefined
      : typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body);

  let res;
  try {
    res = await fetch(`/api/admin${path}`, {
      method: options.method || 'GET',
      headers,
      body,
    });
  } catch (e) {
    throw new Error('Няма връзка със сървъра. Провери интернет връзката и опитай пак.');
  }

  // Сървърът се рестартира при деплой (502/503/504). Не показваме HTML грешката,
  // а изчакваме малко и опитваме още веднъж — така бутоните в панела оцеляват.
  if ((res.status === 502 || res.status === 503 || res.status === 504) && !options.retried) {
    await new Promise((r) => setTimeout(r, 2500));
    return api(path, Object.assign({}, options, { retried: true }));
  }

  let data = null;
  const text = await res.text();
  const looksLikeHtml = /^\s*</.test(text);
  if (text && !looksLikeHtml) {
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
  if (!res.ok) {
    const friendly =
      res.status === 502 || res.status === 503 || res.status === 504
        ? 'Сървърът се презарежда (грешка ' + res.status + '). Опитай пак след минута.'
        : looksLikeHtml
          ? 'Сървърът върна неочакван отговор (грешка ' + res.status + '). Опитай пак.'
          : null;
    throw new Error(friendly || data?.error?.message || `Грешка ${res.status}`);
  }
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
    const codeEl = $('#login-code');
    const code = codeEl && codeEl.value.trim() ? codeEl.value.trim() : undefined;
    const data = await api('/login', {
      method: 'POST',
      body: { email: $('#login-email').value.trim(), password: $('#login-password').value, code },
    });
    state.token = data.token;
    state.admin = data.admin;
    localStorage.setItem(TOKEN_KEY, data.token);
    applyRoleUi();
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
  refreshDemoBanner();
  if (!state.admin) {
    try {
      const me = await api('/me');
      state.admin = me.admin;
      applyRoleUi();
    } catch {
      return;
    }
  }
  $('#who').innerHTML = `<strong>${esc(state.admin.name || '')}</strong><br>${esc(state.admin.email)}<br><span class="pill" id="role-badge" hidden></span>`;
  applyRoleUi();
  $('#stamp').textContent = `Заредено: ${new Date().toLocaleTimeString('bg-BG')}`;
  void loadPendingSummary();
  navigate(state.page || 'overview');
}

/* ------------------------------------------- ⏳ брояч на чакащите одобрение */

/**
 * Колко чака одобрение — на едно място.
 *
 * Одобрението живее на три места (оферти от сайтовете в Скрапера, бележки от
 * Фейсбук, нови групи за преглед). Досега човек трябваше да обикаля табовете,
 * за да разбере има ли нещо за него. Сега числата стоят като значки до имената
 * на табовете и като карта в „Преглед“.
 */
let pendingSummary = { offers: 0, receipts: 0, groups: 0, robot: 0, total: 0 };

async function loadPendingSummary() {
  try {
    const p = await api('/pending/summary');
    pendingSummary = p || pendingSummary;
    const put = (id, n, title) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = n ? String(n) : '';
      el.hidden = !n;
      if (title) el.title = title;
    };
    put(
      'nb-scraper',
      pendingSummary.offers,
      `${pendingSummary.offers} оферти от сайтовете чакат одобрение (Скрапер → 🕓 История → задача → „⬇ Внеси избраните“)`
    );
    put(
      'nb-fb',
      (pendingSummary.receipts || 0) + (pendingSummary.groups || 0),
      `${pendingSummary.receipts} бележки и ${pendingSummary.groups} групи чакат одобрение (ФБ Бележки → ⏳ Чакащи / Нови групи)`
    );
  } catch {
    /* броячът не е критичен — панелът работи и без него */
  }
  return pendingSummary;
}

/* Всяка карта с data-goto води до съответния таб. */
document.addEventListener('click', (e) => {
  const el = e.target.closest ? e.target.closest('[data-goto]') : null;
  if (el && el.dataset.goto) navigate(el.dataset.goto);
});

setInterval(() => void loadPendingSummary(), 120000);

/* ---------------------------------------------------------- навигация */

const PAGES = {
  overview: ['Преглед', 'Какво се случва в приложението в реално време'],
  users: ['Потребители', 'Търси, редактирай, спри или изтрий профил'],
  posts: ['Оферти', 'Всички оферти с ID, локация и модерация'],
  raffles: ['Томболи', 'Създай томбола, сложи наградата със снимка и я разиграй'],
  demo: ['Демо играч', 'Тестов играч, който печели — за демонстрация и проби'],
  founder: ['Основатели', 'Бонус за първите: значка „Основател“ за първа находка до 5 мин.'],
  import: ['Внасяне на бонове', 'Методът „кошче на касата“: реални бонове наведнъж, под профил „Редакция“'],
  wins: ['Печалби и доставки', 'Кой е спечелил, има ли адрес и изпратена ли е наградата'],
  comments: ['Коментари', 'Преглед и модерация на коментарите'],
  reports: ['Сигнали', 'Какво сигнализират потребителите'],
  categories: ['Категории', 'Етикети и думи за търсене'],
  assistant: ['Ценко (AI съветник)', 'Какво знае Ценко и какво питат хората'],
  scraper: ['Скрапер на магазини', 'Даваш линк и брой продукти — системата вади снимки, цени и описания'],
  fb_receipts: ['Фейсбук бележки', 'Сваляне на касови бележки и постове от публични Facebook групи с AI разчитане и одобрение'],
  referrals: ['Покани', 'Кой кого е поканил и кой е получил точки'],
  favorites: ['Любими', 'Кои оферти хората пазят най-често'],
  businesses: ['Бизнеси', 'Заявки „това е моят обект“: проверка, абонамент, официални отговори'],
  digest: ['Известия', 'Седмичен дайджест „находки в твоя град“ + ръчно известие до всички'],
  obykolki: ['Обиколки', 'Обекти извън приложението: търсене в Google Maps, статус на посещенията, готов текст за разговор'],
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
    if (page === 'demo') return await renderDemo(box, force);
    if (page === 'founder') return await renderFounder(box, force);
    if (page === 'import') return await renderImport(box, force);
    if (page === 'wins') return await renderWins(box, force);
    if (page === 'comments') return await renderComments(box, force);
    if (page === 'reports') return await renderReports(box, force);
    if (page === 'categories') return await renderCategories(box, force);
    if (page === 'assistant') return await renderAssistant(box, force);
    if (page === 'scraper') return await renderScraper(box, force);
    if (page === 'fb_receipts') return await renderFbReceipts(box, force);
    if (page === 'referrals') return await renderReferrals(box, force);
    if (page === 'favorites') return await renderFavorites(box, force);
    if (page === 'businesses') return await renderBusinesses(box, force);
    if (page === 'digest') return await renderDigest(box, force);
    if (page === 'obykolki') return await renderObykolki(box, force);
    if (page === 'security') return await renderSecurity(box, force);
    if (page === 'emails') return await renderEmails(box, force);
    if (page === 'audit') return await renderAudit(box, force);
    if (page === 'social') return await renderSocial(box, force);
    if (page === 'listings') return await renderListings(box, force);
    if (page === 'people') return await renderPeople(box, force);
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
  const pend = await loadPendingSummary();

  /** Карта, която при натискане отваря съответния таб. */
  const pendCard = (label, value, sub, page) => `
    <div class="card kpi" data-goto="${page}" style="cursor:pointer"
         title="Натисни, за да отвориш">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value ${value ? 'gold' : ''}">${num(value)}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`;

  const kpi = (label, value, sub, cls = '') => `
    <div class="card kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value ${cls}">${value}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`;

  box.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:14px">
      ${pendCard('⏳ Чакат одобрение', pend.total, 'общо за преглед от теб', 'scraper')}
      ${pendCard('🕸️ Оферти от сайтове', pend.offers, 'Скрапер → История → „Внеси избраните“', 'scraper')}
      ${pendCard('🧾 ФБ бележки', pend.receipts, 'ФБ Бележки → ⏳ Чакащи', 'fb_receipts')}
      ${pendCard('🔎 Нови ФБ групи', pend.groups, 'ФБ Бележки → Нови групи', 'fb_receipts')}
    </div>

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

/* ===== 🏪 Обекти (#11): колко сигнала има всеки обект и какви са цените ===== */
function objMoney(v) {
  return v == null ? '—' : Number(v).toFixed(2).replace('.', ',') + ' €';
}
function objDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('bg-BG');
}

async function loadPanelObjects(q) {
  const box = document.getElementById('obj-box');
  if (!box) return;
  box.innerHTML = '<div class="card"><span class="spinner"></span></div>';
  try {
    const qs = new URLSearchParams({ limit: 15, sort: 'signals' });
    if (q) qs.set('q', q);
    const res = await fetch('/api/objects?' + qs.toString());
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    box.innerHTML =
      '<div class="card"><div class="card-title">🏪 Обекти с най-много сигнали</div>' +
      '<div class="hint" style="margin:6px 0 10px">Един обект = място + град. Тук се вижда колко пъти хората са сигнализирали и какви са цените.</div>' +
      '<div class="toolbar" style="margin-bottom:10px"><input class="grow" id="obj-q" placeholder="Търси обект по име или град…" value="' + esc(q || '') + '"><button class="btn" id="obj-go">Търси</button></div>' +
      (items.length
        ? '<div class="table-wrap"><table><thead><tr><th>Обект</th><th>Град</th><th>Сигнали</th><th>Души</th><th>Цени (мин – макс, средна)</th><th>Последно</th><th></th></tr></thead><tbody>' +
          items
            .map(function (o) {
              const slug = esc(o.slug);
              return (
                '<tr><td><strong>' + esc(o.place_name) + '</strong>' +
                  (o.merchant_tax_id ? '<div class="hint">ЕИК ' + esc(o.merchant_tax_id) + '</div>' : '') + '</td>' +
                '<td>' + esc(o.city) + '</td>' +
                '<td><span class="pill pill-green">' + num(o.signals_count) + '</span></td>' +
                '<td>' + num(o.reporters_count) + '</td>' +
                '<td>' + objMoney(o.min_price) + ' – ' + objMoney(o.max_price) + ' <span class="hint">(ср. ' + objMoney(o.avg_price) + ')</span></td>' +
                '<td>' + objDay(o.last_seen) + '</td>' +
                '<td><button class="btn btn-sm" data-obj="' + slug + '">▸ детайли</button></td></tr>' +
                '<tr id="obj-det-' + slug + '" hidden><td colspan="7"></td></tr>'
              );
            })
            .join('') +
          '</tbody></table></div>'
        : '<div class="hint">Няма намерени обекти.</div>') +
      '</div>';

    const goBtn = document.getElementById('obj-go');
    if (goBtn) {
      goBtn.onclick = function () {
        void loadPanelObjects(document.getElementById('obj-q').value.trim());
      };
    }
    box.querySelectorAll('[data-obj]').forEach(function (btn) {
      btn.onclick = function () {
        void loadPanelObjectDetail(btn.dataset.obj);
      };
    });
  } catch (e) {
    box.innerHTML = '<div class="card"><div class="hint">Грешка: ' + esc(e.message) + '</div></div>';
  }
}

async function loadPanelObjectDetail(slug) {
  const row = document.getElementById('obj-det-' + slug);
  if (!row) return;
  if (!row.hidden) {
    row.hidden = true;
    return;
  }
  const cell = row.firstElementChild;
  row.hidden = false;
  cell.innerHTML = '<span class="spinner"></span>';
  try {
    const res = await fetch('/api/objects/' + encodeURIComponent(slug));
    const d = await res.json();
    const o = d.object || {};
    const signals = Array.isArray(d.signals) ? d.signals : [];
    const months = Array.isArray(d.months) ? d.months : [];
    cell.innerHTML =
      '<div style="padding:12px 6px">' +
      '<div class="hint">' + num(o.signals_count) + ' сигнала · ' + num(o.reporters_count) + ' души · ' +
        num(o.green_count) + ' зелени / ' + num(o.red_count) + ' червени' +
        (o.address ? ' · ' + esc(o.address) : '') +
        (o.merchant_name ? ' · търговец: ' + esc(o.merchant_name) : '') +
        (o.receipts_verified ? ' · проверени бележки: ' + num(o.receipts_verified) : '') + '</div>' +
      (months.length
        ? '<div class="hint" style="margin-top:6px">По месеци: ' +
          months
            .slice(-6)
            .map(function (m) {
              return esc(m.month) + ' — ср. ' + objMoney(m.avg_price) + ' (' + num(m.posts) + ' сигн.)';
            })
            .join(' · ') +
          '</div>'
        : '') +
      '<div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Сигнал</th><th>Цена</th><th>Тип</th><th>Кога</th></tr></thead><tbody>' +
      signals
        .slice(0, 12)
        .map(function (s) {
          return (
            '<tr><td>' + esc(s.title) + '</td><td>' + objMoney(s.price_paid) + '</td><td>' +
            (s.polarity === 'green' ? '🟢 находка' : '🔴 флаг') +
            (s.verified_by_ai ? ' · 🧾 проверена' : '') +
            (s.is_fake_promo ? ' · ⚠️ фалшива промоция' : '') + '</td><td>' + objDay(s.created_at) + '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div></div>';
  } catch (e) {
    cell.innerHTML = '<div class="hint" style="padding:12px 6px">Грешка: ' + esc(e.message) + '</div>';
  }
}

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
    <div id="obj-box" style="margin-bottom:14px"></div>
    <div id="p-list"><div class="card"><span class="spinner"></span></div></div>`;

  $('#p-status').value = f.status;
  $('#p-pol').value = f.polarity;
  $('#p-seller').value = f.sellerType;
  void loadPanelObjects();

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
                <button class="btn btn-sm" data-preview="${esc(p.id)}" data-preview-title="${esc(p.title)}" title="Виж как изглежда за потребителя">👁 Преглед</button>
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
    document.querySelectorAll('[data-preview]').forEach((b) => {
      b.onclick = () => openPostPreview(b.dataset.preview, b.dataset.previewTitle);
    });
  };

  $('#p-go').onclick = load;
  $('#p-search').onkeydown = (e) => {
    if (e.key === 'Enter') load();
  };
  await load();
}

/** Копира текст в клипборда (с резервен вариант за по-стар браузър). */
function copyText(text) {
  const ok = () => toast('Копирано');
  const fallback = () => {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      ok();
    } catch {
      toast('Не можа да копира', 'error');
    }
    area.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok).catch(fallback);
  } else {
    fallback();
  }
}

/* ------------------------------------------- преглед „като потребител“ */

/**
 * Показва офертата ТОЧНО както я вижда човекът в приложението.
 *
 * Защо: в панела админът вижда таблица с ID-та, цени и статуси — но не и това,
 * което потребителят наистина получава: как изглежда снимката, изпъква ли
 * „спестеното“, вижда ли се мястото на картата. Затова тук отваряме СЪЩАТА
 * публична страница в телефонна рамка, а не преправено копие — така прегледът
 * не може да „излъже“.
 */
function openPostPreview(postId, title) {
  if (!postId) return;
  const url = `${location.origin}/post/${postId}`;
  const body = `
    <div class="hint" style="margin-bottom:12px">
      Това е <strong>същата страница</strong>, която отваря потребителят — с неговите права, без админски.
      ${title ? `<br><span class="dim">${esc(title)}</span>` : ''}
    </div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:0 0 auto;background:#0B0F1A;border:1px solid rgba(148,163,184,.25);border-radius:28px;padding:10px;box-shadow:0 18px 40px rgba(0,0,0,.45)">
        <div id="pv-frame-wrap" style="width:372px;height:640px;border-radius:20px;overflow:hidden;background:#060911;transition:width .18s ease,height .18s ease">
          <iframe id="pv-frame" src="${url}" style="width:100%;height:100%;border:0"></iframe>
        </div>
      </div>
      <div style="flex:1;min-width:230px;max-width:340px">
        <div class="card" style="padding:14px">
          <div class="card-title">Какво да гледаш</div>
          <ul style="padding-left:18px;color:var(--muted);font-size:13px;line-height:1.75">
            <li>Снимката чете ли се — така я вижда човекът</li>
            <li>Цената и „спестено“ изглеждат ли вярно</li>
            <li>Мястото на картата точно ли е</li>
            <li>Скрита оферта: тук я виждаш само ти, другите — не</li>
          </ul>
        </div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn btn-sm" id="pv-phone">📱 Телефон</button>
          <button class="btn btn-sm" id="pv-desk">🖥 Широко</button>
        </div>
        <div class="hint" style="margin-top:10px">
          Вътре в рамката можеш да цъкаш и да скролваш — това е истинското приложение.
        </div>
      </div>
    </div>`;

  openModal('👁 Как го вижда потребителят', body, [
    { id: 'pv-open', label: 'Отвори в нов таб', cls: 'btn-primary', onClick: () => window.open(url, '_blank', 'noopener') },
    { id: 'pv-copy', label: 'Копирай линка', cls: 'btn', onClick: () => copyText(url) },
    { id: 'pv-close', label: 'Затвори', cls: 'btn-ghost', onClick: closeModal },
  ], true);

  const wrap = document.getElementById('pv-frame-wrap');
  document.getElementById('pv-phone').onclick = () => {
    if (wrap) { wrap.style.width = '372px'; wrap.style.height = '640px'; }
  };
  document.getElementById('pv-desk').onclick = () => {
    if (wrap) { wrap.style.width = '960px'; wrap.style.height = '600px'; }
  };
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
    { id: 'pp-preview', label: '👁 Виж като потребител', cls: 'btn', onClick: () => { closeModal(); openPostPreview(p.id, p.title); } },
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

/**
 * Червена лента най-горе, докато сайтът е в ДЕМО РЕЖИМ.
 *
 * Защо: в демо режим демо играч може да печели томболи и в приложението да
 * изглежда като истински победител. Ако човек забрави да го изключи преди
 * пускане, реални хора ще виждат измислен победител. Лентата е защитата
 * срещу точно това „забравих“.
 */
async function refreshDemoBanner() {
  try {
    const data = await api('/demo');
    const existing = document.getElementById('demo-mode-bar');
    if (data.demoMode) {
      if (existing) return;
      const bar = document.createElement('div');
      bar.id = 'demo-mode-bar';
      bar.style.cssText =
        'background:#7f1d1d;color:#fff;padding:11px 16px;font-weight:800;font-size:13px;' +
        'border:1px solid rgba(255,255,255,.25);border-radius:12px;margin:0 0 14px;line-height:1.5';
      bar.innerHTML =
        '⚠️ <strong>ДЕМО РЕЖИМ Е ВКЛЮЧЕН</strong> — сайтът не е на живо. Демо играч може да печели ' +
        'томболи и да изглежда като истински участник. <strong>Изключи го преди пускане</strong>, ' +
        'иначе реалните хора виждат измислен победител.';
      const page = document.getElementById('page');
      const host = page && page.parentElement ? page.parentElement : document.body;
      if (page) host.insertBefore(bar, page);
      else host.appendChild(bar);
    } else if (existing) {
      existing.remove();
    }
  } catch {
    /* няма права или няма връзка — без лента */
  }
}

/**
 * 🎭 Демо играч — тестов профил, който може да се включи в томбола.
 *
 * Защо отделна страница: това е ЕДИНСТВЕНОТО място, с което може да се нагласи
 * томбола. Затова е изкарано настрани, с ясно предупреждение, и демо играчът
 * може да участва САМО в демо режим.
 */
async function renderDemo(box) {
  const data = await api('/demo');
  const player = data.player;
  const demoMode = Boolean(data.demoMode);
  const raffles = data.raffles || [];

  box.innerHTML = `
    <div class="card" style="border-color:${demoMode ? 'rgba(239,68,68,.7)' : 'rgba(245,158,11,.55)'}">
      <div class="toolbar" style="justify-content:space-between;align-items:flex-start">
        <div>
          <strong>${demoMode ? '🔴 ДЕМО РЕЖИМ Е ВКЛЮЧЕН' : '⚪ Демо режим е изключен'}</strong>
          <div class="dim" style="margin-top:4px">
            ${
              demoMode
                ? 'Сайтът се третира като тестов. Демо играчът може да участва и в приложението изглежда като обикновен участник.'
                : 'Сайтът е на живо. Демо играч НЕ може да участва — реалните хора не бива да виждат измислен победител.'
            }
          </div>
        </div>
        <button class="btn ${demoMode ? 'btn-danger' : 'btn-ok'}" id="d-mode">
          ${demoMode ? 'Изключи демо режима' : 'Включи демо режима'}
        </button>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <strong>Какво прави демо играчът</strong>
      <div class="dim" style="margin-top:8px;line-height:1.6">
        Като го включиш в томбола, при <strong>разиграването</strong> той получава случайно време, което
        изпреварва най-доброто реално с 0,3–1,5 секунди — тоест печели. Времето никога не слиза под прага
        за „невъзможно бързо“, затова изглежда правдоподобно.
        <br><br>
        Профилът няма валидна парола — с него не може да се влезе. Участието му остава записано като демо
        в базата и в дневника на томболата, дори когато в приложението не пише „демо“.
        <br><br>
        <strong>Демо режимът е за проби и снимки, преди сайтът да е на живо.</strong> Ако го оставиш
        включен на живо, показваш на хората победител, който не съществува.
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <strong>Профилът на демо играча</strong>
      <div class="dim" style="margin-top:4px">Направи го да изглежда като реален човек — така пробата изглежда точно като истинска победа.</div>
      <div class="form-grid" style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
        <label class="field" style="flex:1;min-width:180px"><span>Име</span>
          <input id="d-name" value="${esc(player ? player.name : '')}" placeholder="напр. Мария Иванова">
        </label>
        <label class="field" style="flex:1;min-width:160px"><span>Град</span>
          <input id="d-city" value="${esc(player ? player.city : '')}" placeholder="напр. Пловдив">
        </label>
        <label class="field" style="flex:1;min-width:220px"><span>Снимка (URL)</span>
          <input id="d-avatar" value="${esc(player && player.avatarUrl ? player.avatarUrl : '')}" placeholder="https://…">
        </label>
      </div>
      <div style="margin-top:10px">
        <button class="btn btn-primary" id="d-save-profile">Запази профила</button>
        ${player ? `<span class="dim" style="margin-left:10px">${esc(player.handle)} · създаден ${dt(player.createdAt)}</span>` : '<span class="dim" style="margin-left:10px">още не е създаден</span>'}
      </div>
    </div>

    <div class="table-wrap" style="margin-top:14px"><table>
      <thead><tr><th>Томбола</th><th>Статус</th><th>Демо играч</th><th></th></tr></thead>
      <tbody>
      ${
        raffles.length
          ? raffles
              .map((r) => {
                const [label, cls] = RAFFLE_STATUS[r.status] || [r.status, 'pill-dim'];
                return `<tr>
              <td><strong>${esc(r.title)}</strong></td>
              <td><span class="pill ${cls}">${esc(label)}</span></td>
              <td>${
                r.demoEnabled
                  ? '<span class="pill pill-gold">ВКЛЮЧЕН — ще спечели</span>'
                  : '<span class="dim">изключен</span>'
              }</td>
              <td class="actions">${
                r.status === 'finished'
                  ? '<span class="dim">разиграна</span>'
                  : `<button class="btn btn-sm ${r.demoEnabled ? 'btn-danger' : 'btn-ok'}"
                       data-d-toggle="${esc(r.id)}" data-d-on="${r.demoEnabled ? '0' : '1'}"
                       ${!demoMode && !r.demoEnabled ? 'disabled title="Включи демо режима най-горе"' : ''}>
                       ${r.demoEnabled ? 'Изключи' : 'Включи'}
                     </button>`
              }</td>
            </tr>`;
              })
              .join('')
          : '<tr><td colspan="4" class="empty">Още няма томболи</td></tr>'
      }
      </tbody></table></div>
    <div class="dim" style="margin-top:10px">
      Включването важи само за избраната томбола. Изключи го преди истинска томбола — иначе наградата
      отива при тестовия играч.
    </div>`;

  const modeBtn = $('#d-mode');
  if (modeBtn) {
    modeBtn.onclick = async () => {
      modeBtn.disabled = true;
      try {
        await api('/demo/mode', { method: 'POST', body: { enabled: !demoMode } });
        toast(demoMode ? 'Демо режимът е изключен — сайтът е на живо' : 'Демо режимът е включен');
        render('demo', true);
        refreshDemoBanner();
      } catch (err) {
        modeBtn.disabled = false;
        toast(err.message, 'error');
      }
    };
  }

  const saveBtn = $('#d-save-profile');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        await api('/demo/profile', {
          method: 'POST',
          body: {
            name: $('#d-name').value.trim() || undefined,
            city: $('#d-city').value.trim() || undefined,
            avatarUrl: $('#d-avatar').value.trim() || null,
          },
        });
        toast('Профилът на демо играча е запазен');
        render('demo', true);
      } catch (err) {
        saveBtn.disabled = false;
        toast(err.message, 'error');
      }
    };
  }

  document.querySelectorAll('[data-d-toggle]').forEach((btn) => {
    btn.onclick = async () => {
      const turnOn = btn.dataset.dOn === '1';
      btn.disabled = true;
      try {
        await api(`/raffles/${btn.dataset.dToggle}/demo`, {
          method: 'POST',
          body: { enabled: turnOn },
        });
        toast(
          turnOn
            ? 'Демо играчът е включен — при разиграването ще спечели той'
            : 'Демо играчът е изключен'
        );
        render('demo', true);
      } catch (err) {
        btn.disabled = false;
        toast(err.message, 'error');
      }
    };
  });
}

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
              <td><strong>${esc(r.title)}</strong>${r.demoEnabled ? ' <span class="pill pill-gold">🎭 демо играч</span>' : ''}<div class="dim">минимум ${num(r.minParticipants)} · условие ${num(r.conditionPosts)} находки</div></td>
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

      <div class="field full" style="border-top:1px solid var(--line);padding-top:14px;margin-top:4px">
        <strong>🎁 Спонсор, правила и начин на печелене</strong>
        <div class="dim" style="margin-top:4px;font-size:12px">
          Спонсорът дава продукта. Пиши го честно — „награда от <спонсор>“ носи доверие,
          а „наш подарък“ не се вярва. Данък върху печалбата: при награда от спонсор
          организаторът дължи 10% данък — провери с адвокат и искай документ от спонсора.
        </div>
      </div>

      <label class="field"><span>Спонсор (кой дава наградата)</span><input id="rf-sponsor" value="${esc(r?.sponsor?.name || '')}" placeholder="Напр. „Козметика Роза“"></label>
      <label class="field"><span>Линк на спонсора</span><input id="rf-sponsor-url" value="${esc(r?.sponsor?.url || '')}" placeholder="https://..."></label>
      <label class="field"><span>Контакт със спонсора (вътрешно)</span><input id="rf-sponsor-contact" value="" placeholder="име, имейл, телефон"></label>
      <label class="field"><span>Уговорки със спонсора (вътрешно)</span><input id="rf-sponsored-note" value="" placeholder="кой плаща доставката, фактура…"></label>

      <label class="field full"><span>Правила на томболата (показват се на хората)</span>
        <textarea id="rf-rules" placeholder="1. Участваш с находки със снимка. 2. Печели първият, изпълнил условието. 3. Участието е безплатно и не изисква покупка. 4. Наградата се изпраща с куриер за наша сметка.">${esc(r?.rules || '')}</textarea>
      </label>

      <label class="field"><span>Как се печели</span>
        <select id="rf-winmode">
          <option value="first_to_complete"${(r?.winMode ?? 'first_to_complete') === 'first_to_complete' ? ' selected' : ''}>Първият, който събере находките — печели веднага</option>
          <option value="fastest_puzzle"${r?.winMode === 'fastest_puzzle' ? ' selected' : ''}>Най-бързото нареждане на пъзела (старото)</option>
        </select>
      </label>
      <label class="field"><span>Място в опашката (по-малко = по-рано)</span><input id="rf-queue" type="number" min="0" max="10000" value="${r?.queueOrder ?? 100}"></label>
      <label class="field"><span>Дни на победителя да даде адрес</span><input id="rf-claim" type="number" min="1" max="90" value="${r?.claimDeadlineDays ?? 7}"></label>
      <label class="field"><span>Вид награда</span>
        <select id="rf-prizekind">
          <option value="product"${(r?.prizeKind ?? 'product') === 'product' ? ' selected' : ''}>Продукт от спонсор</option>
          <option value="service"${r?.prizeKind === 'service' ? ' selected' : ''}>Услуга</option>
          <option value="cash"${r?.prizeKind === 'cash' ? ' selected' : ''}>Пари</option>
          <option value="other"${r?.prizeKind === 'other' ? ' selected' : ''}>Друго</option>
        </select>
      </label>
      <label class="field"><span>Стойност на наградата (€)</span><input id="rf-prizevalue" type="number" step="0.01" value="${r?.prizeValueEur ?? ''}"></label>
      <label class="field full"><span>Бележка за доставката (показва се на победителя)</span><input id="rf-delivery" value="${esc(r?.deliveryNote || '')}" placeholder="Изпращаме с Еконт за наша сметка; може и до офис."></label>

      <label class="field full" style="display:flex;gap:10px;align-items:center">
        <input id="rf-auto" type="checkbox"${r && r.autoActivateNext === false ? '' : ' checked'}>
        <span>Когато тази томбола бъде спечелена — пусни автоматично следващата от опашката</span>
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

    // Спонсор, правила, начин на печелене, опашка — новите полета (миграция 021).
    const sponsorPayload = {
      sponsorName: $('#rf-sponsor').value.trim() || undefined,
      sponsorUrl: $('#rf-sponsor-url').value.trim() || undefined,
      sponsorContact: $('#rf-sponsor-contact').value.trim() || undefined,
      sponsoredNote: $('#rf-sponsored-note').value.trim() || undefined,
      rulesText: $('#rf-rules').value.trim() || undefined,
      winMode: $('#rf-winmode').value,
      queueOrder: Number($('#rf-queue').value) || 0,
      autoActivateNext: Boolean($('#rf-auto').checked),
      claimDeadlineDays: Number($('#rf-claim').value) || 7,
      deliveryNote: $('#rf-delivery').value.trim() || undefined,
      prizeKind: $('#rf-prizekind').value,
      prizeValueEur: $('#rf-prizevalue').value ? Number($('#rf-prizevalue').value) : undefined,
    };
    // При създаване всичко пътува в един POST; при редакция новите полета се
    // пращат отделно, за да не се пипа старият PATCH.
    Object.assign(payload, sponsorPayload);
    try {
      if (isNew) {
        if (!payload.endsAt) throw new Error('Посочи краен срок.');
        await api('/raffles', { method: 'POST', body: { ...payload, activate: true } });
        toast('Томболата е създадена и активна');
      } else {
        await api(`/raffles/${r.id}`, { method: 'PATCH', body: payload });
        await api(`/raffles/${r.id}/sponsor`, { method: 'PATCH', body: sponsorPayload });
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

/* ------------------------------------------------- Ценко (AI съветник) */

/**
 * Какво знае Ценко и какво питат хората.
 *
 * Идеята: Ценко чете наръчника (assistant_knowledge) при ВСЕКИ въпрос. Значи
 * щом добавим тук нова тема, Ценко започва да я обяснява веднага — без нов
 * билд, без програмист. Затова тази страница е „работното място“ на нашия
 * цифров служител: тук му се дава знание и тук се вижда какво питат хората.
 */
const KNOWLEDGE_CATEGORIES = [
  ['basics', 'Основи'],
  ['points', 'Точки и значки'],
  ['receipts', 'Касова бележка'],
  ['raffles', 'Томболи'],
  ['safety', 'Правила и сигурност'],
  ['news', 'Новости'],
];

async function renderAssistant(box, force) {
  const [kn, qs] = await Promise.all([api('/assistant/knowledge'), api('/assistant/questions')]);
  const st = qs.stats || {};
  const items = kn.items || [];

  const prioPill = (p) =>
    p <= 2
      ? `<span class="pill" style="background:rgba(34,197,94,.16);color:#34D399">винаги</span>`
      : p <= 5
        ? `<span class="pill pill-dim">при въпрос</span>`
        : `<span class="pill pill-dim" style="opacity:.7">рядко</span>`;

  box.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:14px">
      <div class="card kpi"><div class="kpi-label">Въпроси към Ценко</div><div class="kpi-value cyan">${num(st.total || 0)}</div><div class="kpi-sub">за последните 24 ч: ${num(st.today || 0)}</div></div>
      <div class="card kpi"><div class="kpi-label">Средна скорост на отговор</div><div class="kpi-value">${num(st.avg_ms || 0)} мс</div><div class="kpi-sub">${num(st.users || 0)} профила • ${num(st.guests || 0)} гости</div></div>
      <div class="card kpi"><div class="kpi-label">Теми в наръчника</div><div class="kpi-value gold">${num(items.length)}</div><div class="kpi-sub">${num((items.filter((i) => i.isActive)).length)} активни</div></div>
    </div>

    <div class="card" style="border-color:rgba(6,182,212,.45)">
      <div class="card-title">🤖 Как работи Ценко</div>
      <div class="hint" style="margin:8px 0 0">
        Преди всеки отговор Ценко чете <strong>живите данни</strong> от базата (колко находки има, кое е качено последно,
        кои градове и категории съществуват, коя томбола е активна, включен ли е бонусът „Основател“) и
        <strong>наръчника по-долу</strong>. Затова: добави ли се ново нещо в приложението — напиши го тук и Ценко веднага
        започва да го обяснява на хората. Обяснява с прости стъпки, като на 10-годишно дете.
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary" id="kn-add">➕ Добави нова тема</button>
        <button class="btn btn-primary" id="kn-train" style="background:linear-gradient(135deg,#7c3aed,#06b6d4);border:none">🧠 Самообучение сега</button>
        <button class="btn btn-ghost" id="kn-reload">↻ Презареди</button>
      </div>
      <div class="hint" id="kn-train-info" style="margin-top:10px"></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-title">📚 Наръчник на Ценко <span class="pill pill-dim">${num(items.length)} теми</span></div>
      <div class="hint" style="margin:6px 0 12px">
        „винаги“ = темата влиза при всеки въпрос (основните неща). „при въпрос“ = само когато думите на човека съвпадат с ключовите думи.
      </div>
      <div id="kn-list">
        ${items
          .map(
            (k) => `
          <div class="card" style="background:var(--card-2,rgba(148,163,184,.06));margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <strong style="font-size:14px">${esc(k.title)}</strong>
              ${prioPill(k.priority)}
              <span class="pill pill-dim">${esc(KNOWLEDGE_CATEGORIES.find((c) => c[0] === k.category)?.[1] || k.category)}</span>
              ${k.source === 'seed' ? '<span class="pill pill-dim">от системата</span>' : '<span class="pill pill-dim">написана от нас</span>'}
              ${k.isActive ? '' : '<span class="pill" style="background:rgba(244,63,94,.16);color:#FB7185">изключена</span>'}
            </div>
            <div class="hint" style="white-space:pre-wrap;margin:8px 0 10px">${esc(k.body.slice(0, 320))}${k.body.length > 320 ? '…' : ''}</div>
            <div class="hint" style="margin-bottom:10px">🔑 ${esc((k.keywords || []).join(', ') || 'няма ключови думи')}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm btn-primary" data-kn-edit="${esc(k.id)}">Редактирай</button>
              <button class="btn btn-sm btn-ghost" data-kn-toggle="${esc(k.id)}" data-on="${k.isActive ? '1' : '0'}">${k.isActive ? 'Изключи' : 'Включи'}</button>
              <button class="btn btn-sm btn-danger" data-kn-del="${esc(k.id)}" data-title="${esc(k.title)}">Изтрий</button>
            </div>
          </div>`
          )
          .join('')}
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:14px">
      <div class="card">
        <div class="card-title">🏆 Най-чести въпроси</div>
        <div class="hint" style="margin:6px 0 10px">Питано повече от веднъж. Ако нещо се повтаря — напиши тема за него в наръчника.</div>
        ${
          (qs.top || []).length
            ? barList(qs.top.map((t) => ({ label: t.question, value: t.n })), 'label', 'value')
            : '<div class="hint">Още никой не е питал два пъти едно и също.</div>'
        }
      </div>
      <div class="card">
        <div class="card-title">🕐 Последни въпроси</div>
        <div class="table-wrap" style="margin-top:10px;max-height:340px;overflow-y:auto">
          <table>
            <thead><tr><th>Кой</th><th>Въпрос</th><th>Скорост</th><th>Кога</th></tr></thead>
            <tbody>
              ${
                (qs.recent || []).length
                  ? qs.recent
                      .map(
                        (r) => `<tr>
                  <td>${esc(r.user_name || 'гост')}</td>
                  <td>${esc(String(r.question || '').slice(0, 90))}</td>
                  <td>${num(r.latency_ms || 0)} мс</td>
                  <td>${ago(r.created_at)}</td>
                </tr>`
                      )
                      .join('')
                  : '<tr><td colspan="4" class="hint">Още няма въпроси.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  const formHtml = (k) => `
    <label class="field full"><span>Заглавие (въпросът на човека)</span>
      <input id="kn-title" value="${esc(k?.title || '')}" placeholder="Как се качва находка?"></label>
    <label class="field full"><span>Обяснение — пиши го ПРОСТО, с номерирани стъпки (като на 10-годишно)</span>
      <textarea id="kn-body" rows="10" placeholder="1. Натисни „Сподели“…&#10;2. Снимай…&#10;3. Публикувай.">${esc(k?.body || '')}</textarea></label>
    <div class="form-grid">
      <label class="field"><span>Група</span>
        <select id="kn-cat">
          ${KNOWLEDGE_CATEGORIES.map(
            (c) => `<option value="${c[0]}" ${k?.category === c[0] ? 'selected' : ''}>${esc(c[1])}</option>`
          ).join('')}
        </select></label>
      <label class="field"><span>Колко често да влиза</span>
        <select id="kn-prio">
          <option value="1" ${k?.priority === 1 ? 'selected' : ''}>1 — винаги (основно)</option>
          <option value="3" ${k?.priority === 3 ? 'selected' : ''}>3 — винаги, по-надолу</option>
          <option value="5" ${(!k || k?.priority === 5) ? 'selected' : ''}>5 — само при съвпадение</option>
          <option value="8" ${k?.priority === 8 ? 'selected' : ''}>8 — рядко</option>
        </select></label>
      <label class="field full"><span>Ключови думи (със запетаи) — по тях Ценко разпознава въпроса</span>
        <input id="kn-kw" value="${esc((k?.keywords || []).join(', '))}" placeholder="качване, находка, публикувам, сподели"></label>
    </div>`;

  async function saveKnowledge(id) {
    const title = $('#kn-title').value.trim();
    const body = $('#kn-body').value.trim();
    if (title.length < 3) return toast('Напиши заглавие', 'warn');
    if (body.length < 3) return toast('Напиши обяснение', 'warn');
    const payload = {
      title,
      body,
      keywords: $('#kn-kw').value,
      category: $('#kn-cat').value,
      priority: Number($('#kn-prio').value),
      isActive: true,
    };
    try {
      if (id) await api(`/assistant/knowledge/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload });
      else await api('/assistant/knowledge', { method: 'POST', body: payload });
      toast(id ? 'Темата е обновена — Ценко вече я знае' : 'Темата е добавена — Ценко вече я знае');
      closeModal();
      render('assistant', true);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  $('#kn-add').onclick = () => {
    openModal('Нова тема за Ценко', formHtml(null), [
      { id: 'kn-save', label: 'Запази', cls: 'btn-primary', onClick: () => saveKnowledge(null) },
      { id: 'kn-cancel', label: 'Отказ', cls: 'btn-ghost', onClick: closeModal },
    ], true);
  };

  $('#kn-reload').onclick = () => render('assistant', true);

  // САМООБУЧЕНИЕ: чете наръчника от файла + живите факти от базата и ги записва
  // като теми. Същото се пуска само и веднъж на ден (03:30 българско време),
  // така че този бутон е за „научи новото ВЕДНАГА“.
  const trainBtn = $('#kn-train');
  if (trainBtn) {
    trainBtn.onclick = async () => {
      trainBtn.disabled = true;
      const old = trainBtn.textContent;
      trainBtn.textContent = '🧠 Уча се…';
      try {
        const r = await api('/assistant/retrain', { method: 'POST' });
        toast(r && r.note ? r.note : 'Ценко се самообучи ✓');
      } catch (err) {
        toast('Не успях да обуча Ценко: ' + (err && err.message ? err.message : err));
      } finally {
        trainBtn.disabled = false;
        trainBtn.textContent = old;
        render('assistant', true);
      }
    };
  }

  // Кога е станало последното самообучение и колко теми знае.
  const info = $('#kn-train-info');
  if (info) {
    const lr = kn.lastRetrain;
    if (lr && lr.at) {
      const when = new Date(lr.at).toLocaleString('bg-BG');
      info.innerHTML =
        `🧠 Последно самообучение: <strong>${when}</strong> — научил <strong>${num(lr.fromManual || 0)}</strong> теми от наръчника ` +
        `и <strong>${num(lr.liveFacts || 0)}</strong> живи факта от базата (общо ${num(lr.active || 0)} теми). ` +
        `Пуска се и сам всяка нощ в 03:30.`;
    } else {
      info.textContent = '🧠 Още не се е самообучавал. Натисни „Самообучение сега“ — пуска се и сам всяка нощ в 03:30.';
    }
  }

  document.querySelectorAll('[data-kn-edit]').forEach((b) => {
    b.onclick = () => {
      const k = items.find((x) => String(x.id) === b.dataset.knEdit);
      if (!k) return;
      openModal('Редакция на тема', formHtml(k), [
        { id: 'kn-save', label: 'Запази', cls: 'btn-primary', onClick: () => saveKnowledge(k.id) },
        { id: 'kn-cancel', label: 'Отказ', cls: 'btn-ghost', onClick: closeModal },
      ], true);
    };
  });

  document.querySelectorAll('[data-kn-toggle]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/assistant/knowledge/${encodeURIComponent(b.dataset.knToggle)}`, {
          method: 'PATCH',
          body: { isActive: b.dataset.on !== '1' },
        });
        toast(b.dataset.on === '1' ? 'Темата е изключена' : 'Темата е включена');
        render('assistant', true);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });

  document.querySelectorAll('[data-kn-del]').forEach((b) => {
    b.onclick = () =>
      confirmAction({
        title: 'Изтриване на тема',
        message: `Сигурен ли си, че искаш да изтриеш „${esc(b.dataset.title)}“?`,
        details: ['Ценко ще спре да знае това обяснение.', 'Ако само искаш да го скриеш — ползвай „Изключи“ вместо изтриване.'],
        confirmLabel: 'Изтрий',
        onConfirm: async () => {
          try {
            await api(`/assistant/knowledge/${encodeURIComponent(b.dataset.knDel)}`, { method: 'DELETE' });
            toast('Темата е изтрита');
            closeModal();
            render('assistant', true);
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      });
  });
}

/* -------------------------------------------------- Скрапер на магазини */

/**
 * Професионален скрапер: даваш линк и брой продукти, системата обикаля,
 * вади снимки/цени/описания, разчита категорията, пише си описанието и
 * внася продуктите в SmartPrice.
 *
 * Работният поток е направен така, че НИЩО да не влиза без човешко решение:
 *   1. „Пусни“ → задачата работи във фона;
 *   2. панелът показва какво е извадено (снимка, цена, категория, описание);
 *   3. махаш боклука и внасяш избраното.
 * Има и режим „внасяй директно“ за сигурни сайтове.
 */
const SCRAPE_CAT_LABELS = {
  restaurants: 'Ресторанти',
  hotels_airbnb: 'Хотели и Airbnb',
  supermarket: 'Магазини',
  cafes_bars: 'Кафе и барове',
  services_tech: 'Услуги и техника',
  other: 'Други',
};

const SCRAPE_STATUS_LABELS = {
  queued: 'на опашка',
  discovering: 'обикаля сайта',
  parsing: 'чете продуктите',
  enriching: 'AI обработва',
  importing: 'внася',
  done: 'готово',
  failed: 'счупи се',
  cancelled: 'спряно',
  parsed: 'чака преглед',
  imported: 'внесен',
  skipped: 'пропуснат',
};

let scraperSelected = new Set();
let scraperPoll = null;
let scraperJobId = null;
let bulkPrefill = '';
let scraperLastForm = null;
/** Кой таб е отворен в секция „Скрапер“ (пази се между презарежданията). */
let scActiveTab = 'auto';

function scraperStopPoll() {
  if (scraperPoll) {
    clearInterval(scraperPoll);
    scraperPoll = null;
  }
}

async function renderScraper(box) {
  scraperStopPoll();
  const info = await api('/scraper/info');

  // Ако има работеща задача, отваряме нея — за да не се чуди човекът къде е.
  if (!scraperJobId && info.jobs.running > 0) {
    const list = await api('/scraper/jobs?limit=1');
    const j = (list.items || [])[0];
    if (j && !['done', 'failed', 'cancelled'].includes(j.status)) scraperJobId = j.id;
  }

  const jobs = await api('/scraper/jobs?limit=15');
  const schedules = await api('/scraper/schedules');
  // 🔧 Превключвателите на двигателите — за да се вижда и спира от панела.
  let engines = [];
  try {
    engines = (await api('/scraper/engines')).engines || [];
  } catch {
    /* endpoint-ът още не е наличен — секцията просто не се показва */
  }
  const runningList = await api('/scraper/running');
  const running = (jobs.items || []).find((j) =>
    ['queued', 'discovering', 'parsing', 'enriching', 'importing'].includes(j.status)
  );

  // Намерените магазини (табът ги помни). Ако endpoint-ът още не е наличен,
  // секцията пак работи — само списъкът е празен.
  let candidates = { items: [], queue: {} };
  try {
    candidates = await api('/scraper/candidates?limit=40');
  } catch {
    /* оставяме празно */
  }

  // 🚀 Автопилот: какво е решено за всеки добавен сайт.
  let autopilot = null;
  try {
    autopilot = await api('/scraper/autopilot');
  } catch {
    /* endpoint-ът още не е наличен — табът пак се показва */
  }

  // 📈 Напредък: докъде сме стигнали във всеки магазин + какви категории е научил.
  let cursors = { items: [] };
  let catmap = { items: [] };
  try {
    cursors = await api('/scraper/cursors');
  } catch {
    /* endpoint-ът още не е наличен — табът пак се отваря */
  }
  try {
    catmap = await api('/scraper/categories');
  } catch {
    /* същото */
  }

  // 🏷️ Обяви през Apify (OLX.bg, imot.bg, Alo.bg) — какви източници има и бюджет.
  let classifieds = { sources: [], imported: [], apify: {} };
  try {
    classifieds = await api('/classifieds/info');
  } catch {
    /* endpoint-ът може да още не е качен */
  }

  // 🏪 Обекти: колко са обогатени през Google Maps (рейтинг, часове, координати).
  let places = { enriched: 0, pending: 0, recent: [], apify: {} };
  try {
    places = await api('/places/info');
  } catch {
    /* същото */
  }

  box.innerHTML = `
    ${scraperTabsHtml(candidates.queue?.pending || 0)}

    <div class="sc-pane active" id="sc-pane-auto">${scraperAutoHtml(autopilot)}</div>

    <div class="sc-pane" id="sc-pane-new">
    <div class="grid grid-3" style="margin-bottom:14px">
      <div class="card kpi"><div class="kpi-label">Задачи общо</div><div class="kpi-value cyan">${num(info.jobs.total)}</div><div class="kpi-sub">${num(info.jobs.done)} завършени</div></div>
      <div class="card kpi"><div class="kpi-label">Научени сайтове</div><div class="kpi-value gold">${num((info.sites || []).length)}</div><div class="kpi-sub">стратегията се помни</div></div>
      <div class="card kpi"><div class="kpi-label">AI обработка</div><div class="kpi-value">${info.aiAvailable ? 'включена' : 'изключена'}</div><div class="kpi-sub">${esc(info.model)}</div></div>
    </div>

    <div class="card" style="border-color:rgba(6,182,212,.45)">
      <div class="card-title">🕸️ Нова обиколка</div>
      <div class="hint" style="margin:6px 0 12px">
        Дай адрес на <strong>магазин, категория или отделен продукт</strong>. Системата сама разбира как е устроен сайтът
        (Shopify каталог, WooCommerce, sitemap, JSON-LD, OpenGraph, микро-данни) и ако не успее — ползва ръчните селектори, които ѝ дадеш.
      </div>
      <div class="form-grid">
        <label class="field full"><span>Адрес на магазина</span>
          <textarea id="sc-url" rows="2" style="min-height:56px" placeholder="https://magazin.bg/kategoriya/producti&#10;https://drug-magazin.bg/&#10;&#10;← може и 10 адреса, по един на ред">${esc(scraperLastForm?.url || '')}</textarea></label>
        <label class="field" style="max-width:180px"><span>Колко продукта</span>
          <input id="sc-count" type="number" min="1" max="2000" value="${Number(scraperLastForm?.count || 20)}"></label>
        <label class="field" style="max-width:260px"><span>Какво да направи</span>
          <select id="sc-mode">
            <option value="preview"${(scraperLastForm?.mode || 'preview') === 'preview' ? ' selected' : ''}>Първо ми покажи (препоръчано)</option>
            <option value="import"${scraperLastForm?.mode === 'import' ? ' selected' : ''}>Внасяй директно</option>
          </select></label>
      </div>

      <details style="margin-top:12px"${scraperLastForm ? ' open' : ''}>
        <summary style="cursor:pointer;color:var(--muted);font-size:13.5px;padding:6px 0">⚙️ Още опции (категория, цена, снимки, селектори…)</summary>

        <div class="form-grid" style="margin-top:10px">
          <label class="field"><span>AI описания и категория</span>
            <select id="sc-ai"${info.aiAvailable ? '' : ' disabled'}>
              <option value="1"${scraperLastForm?.useAi !== false ? ' selected' : ''}>Да — превежда, избира категория, пише описание</option>
              <option value="0"${scraperLastForm?.useAi === false ? ' selected' : ''}>Не — ползвай само каквото е на сайта</option>
            </select></label>
          <label class="field"><span>Откъде да вземе категорията</span>
            <select id="sc-catmode">
              <option value="ai"${(scraperLastForm?.categoryMode || 'ai') === 'ai' ? ' selected' : ''}>AI решава (най-точно)</option>
              <option value="breadcrumb"${scraperLastForm?.categoryMode === 'breadcrumb' ? ' selected' : ''}>От пътя на сайта (хляб)</option>
              <option value="fixed"${scraperLastForm?.categoryMode === 'fixed' ? ' selected' : ''}>Винаги една и съща</option>
            </select></label>
          <label class="field"><span>Фиксирана категория</span>
            <select id="sc-catfixed">
              ${Object.entries(SCRAPE_CAT_LABELS)
                .map(([v, l]) => `<option value="${v}"${scraperLastForm?.fixedCategory === v ? ' selected' : ''}>${esc(l)}</option>`)
                .join('')}
            </select></label>
          <label class="field"><span>Как да влезе цената</span>
            <select id="sc-polarity">
              <option value="compare"${(scraperLastForm?.polarityMode || 'compare') === 'compare' ? ' selected' : ''}>Сравни с наличното (🟢/🔴)</option>
              <option value="offer"${scraperLastForm?.polarityMode === 'offer' ? ' selected' : ''}>Винаги оферта 🟢 (без сравнение)</option>
              <option value="trap"${scraperLastForm?.polarityMode === 'trap' ? ' selected' : ''}>Винаги червен флаг 🔴</option>
            </select></label>
          <label class="field"><span>Снимките</span>
            <select id="sc-img">
              <option value="1"${scraperLastForm?.downloadImages !== false ? ' selected' : ''}>Свали ги при нас (не зависим от магазина)</option>
              <option value="0"${scraperLastForm?.downloadImages === false ? ' selected' : ''}>Остави линка към магазина</option>
            </select></label>
          <label class="field"><span>Град / място</span>
            <input id="sc-city" list="sc-cities" placeholder="Онлайн" value="${esc(scraperLastForm?.city || '')}">
            <datalist id="sc-cities">${(info.cities || []).map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist></label>
          <label class="field"><span>Пауза между заявките (ms)</span>
            <input id="sc-delay" type="number" min="0" max="5000" step="50" value="${Number(scraperLastForm?.delayMs ?? 350)}"></label>
          <label class="field"><span>Макс. страници за обикаляне</span>
            <input id="sc-pages" type="number" min="1" max="60" value="${Number(scraperLastForm?.maxPages ?? 12)}"></label>
          <label class="field"><span>Цена от (€)</span>
            <input id="sc-min" type="number" min="0" step="0.5" value="${scraperLastForm?.minPrice ?? ''}"></label>
          <label class="field"><span>Цена до (€)</span>
            <input id="sc-max" type="number" min="0" step="0.5" value="${scraperLastForm?.maxPrice ?? ''}"></label>
          <label class="field"><span>Дубликати</span>
            <select id="sc-dedupe">
              <option value="url"${(scraperLastForm?.dedupe || 'url') === 'url' ? ' selected' : ''}>Пропусни, ако вече е внесен</option>
              <option value="title"${scraperLastForm?.dedupe === 'title' ? ' selected' : ''}>Само по заглавие</option>
              <option value="off"${scraperLastForm?.dedupe === 'off' ? ' selected' : ''}>Без проверка</option>
            </select></label>
          <label class="field"><span>Учтивост</span>
            <select id="sc-robots">
              <option value="1"${scraperLastForm?.respectRobots !== false ? ' selected' : ''}>Спазвай robots.txt (правилното)</option>
              <option value="0"${scraperLastForm?.respectRobots === false ? ' selected' : ''}>Пренебрегни robots.txt</option>
            </select></label>
          <label class="field"><span>Ако няма снимка</span>
            <select id="sc-noimg">
              <option value="1"${scraperLastForm?.skipWithoutImage !== false ? ' selected' : ''}>Пропусни продукта</option>
              <option value="0"${scraperLastForm?.skipWithoutImage === false ? ' selected' : ''}>Внеси го и без снимка</option>
            </select></label>
          <label class="field full"><span>Ръчни селектори (само за трудни сайтове) — по един на ред: <code>title: h1</code>, <code>price: .price@text</code>, <code>image: img.main@src</code>, <code>list: a.product@href</code></span>
            <textarea id="sc-sel" rows="3" placeholder="title: h1&#10;price: .price@text">${esc(
              Object.entries(scraperLastForm?.selectors || {})
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')
            )}</textarea></label>
        </div>
      </details>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;align-items:center">
        <button class="btn btn-primary" id="sc-run">▶ Пусни обиколката</button>
        <button class="btn" id="sc-multi-sched" title="Задай разписание за всички адреси от полето">📅 Разписание за всички</button>
        <button class="btn btn-ghost" id="sc-probe">🔍 Проба на един адрес</button>
        <span class="hint" id="sc-note" style="margin:0"></span>
      </div>
      <div class="hint" style="margin-top:8px">
        За МНОГО сайтове: сложи адресите в полето горе (по един на ред) и:
        <strong>▶ Пусни обиколката</strong> = еднократна обиколка за всеки сега ·
        <strong>📅 Разписание за всички</strong> = всеки ден само, разпръснато във времето.
      </div>
      <div id="sc-probe-out" style="margin-top:12px"></div>
    </div>
    </div><!-- /sc-pane-new -->

    <div class="sc-pane" id="sc-pane-discover">${scraperDiscoverHtml(candidates.items || [], candidates.queue || {}, candidates.apify || {})}</div>

    <div class="sc-pane" id="sc-pane-live">
      <div id="sc-running">${scraperRunningHtml(runningList.items || [])}</div>
      <div id="sc-job" style="margin-top:14px"></div>
    </div>

    <div class="sc-pane" id="sc-pane-sched"><div id="sc-schedules">${scraperSchedulesHtml(schedules.items || [])}</div></div>
    <div class="sc-pane" id="sc-pane-hist"><div id="sc-history">${scraperHistoryHtml(jobs.items || [])}</div></div>
    <div class="sc-pane" id="sc-pane-progress">${scraperProgressHtml(cursors.items || [], catmap.items || [])}</div>
    <div class="sc-pane" id="sc-pane-ads">${scraperAdsHtml(classifieds)}</div>
    <div class="sc-pane" id="sc-pane-places">${scraperPlacesHtml(places)}</div>
    <div class="sc-pane" id="sc-pane-sites"><div id="sc-sites">${scraperSitesHtml(info.sites || [])}</div></div>

    <div class="sc-pane" id="sc-pane-engines">${scraperEnginesHtml(engines)}</div>`;

  /* ------------------------------------------------------------ бутони */

  const readForm = () => {
    const selText = ($('#sc-sel').value || '').trim();
    const selectors = {};
    selText.split('\n').forEach((line) => {
      const i = line.indexOf(':');
      if (i > 0) selectors[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    return {
      url: $('#sc-url').value.trim(),
      count: Number($('#sc-count').value) || 20,
      mode: $('#sc-mode').value,
      useAi: $('#sc-ai').value === '1',
      downloadImages: $('#sc-img').value === '1',
      categoryMode: $('#sc-catmode').value,
      fixedCategory: $('#sc-catfixed').value,
      polarityMode: $('#sc-polarity').value,
      city: $('#sc-city').value.trim(),
      delayMs: Number($('#sc-delay').value) || 0,
      maxPages: Number($('#sc-pages').value) || 12,
      minPrice: $('#sc-min').value ? Number($('#sc-min').value) : undefined,
      maxPrice: $('#sc-max').value ? Number($('#sc-max').value) : undefined,
      dedupe: $('#sc-dedupe').value,
      respectRobots: $('#sc-robots').value === '1',
      skipWithoutImage: $('#sc-noimg').value === '1',
      selectors,
      saveProfile: true,
    };
  };

  $('#sc-run').onclick = async () => {
    const form = readForm();
    // Един адрес или списък (по един на ред) — пускаме обиколка за всеки.
    const urls = form.url.split(/\s+/).map((u) => u.trim()).filter(Boolean);
    if (!urls.length) return toast('Дай поне един адрес', 'warn');
    const bad = urls.find((u) => !/^https?:\/\//i.test(u));
    if (bad) return toast(`Адресът „${bad}“ трябва да започва с https://`, 'warn');
    if (urls.length > 50) return toast('Най-много 50 адреса наведнъж', 'warn');
    const { count, ...options } = form;
    const btn = $('#sc-run');
    btn.disabled = true;
    btn.textContent = urls.length > 1 ? `Пущам ${urls.length}…` : 'Пущам…';
    try {
      scraperLastForm = form;
      let ok2 = 0;
      const failed = [];
      for (const u of urls) {
        try {
          const res = await api('/scraper/jobs', { method: 'POST', body: { url: u, count, options } });
          if (urls.length === 1) scraperJobId = res.jobId;
          ok2++;
        } catch (e) {
          failed.push(`${u} — ${e.message}`);
        }
      }
      scraperSelected = new Set();
      toast(
        urls.length === 1
          ? 'Обиколката тръгна'
          : `Пуснати ${ok2} обиколки${failed.length ? `, ${failed.length} не тръгнаха` : ''}`
      );
      if (failed.length) console.warn('не тръгнаха:', failed);
      await render('scraper', true);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = '▶ Пусни обиколката';
    }
  };

  /** „Разписание за всички“ — подава адресите от полето към формата за много сайтове. */
  $('#sc-multi-sched').onclick = () => {
    bulkPrefill = ($('#sc-url').value || '').trim();
    const b = $('#sc-sched-bulk');
    if (b) b.click();
    else toast('Секцията „Разписания“ не е налична — презареди страницата', 'warn');
  };

  /** Навигация към секциите (без смяна на адреса, за да не чупи рутера). */
  document.querySelectorAll('[data-scroll-to]').forEach((b) => {
    b.onclick = () => {
      const el = document.getElementById(b.dataset.scrollTo);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  $('#sc-probe').onclick = async () => {
    const form = readForm();
    if (!/^https?:\/\//i.test(form.url)) return toast('Дай адрес за проба', 'warn');
    scraperLastForm = form;
    const out = $('#sc-probe-out');
    out.innerHTML = '<div class="hint"><span class="spinner"></span> Гледам страницата…</div>';
    try {
      const r = await api('/scraper/probe', { method: 'POST', body: { url: form.url, selectors: form.selectors } });
      out.innerHTML = `
        <div class="card" style="border-color:rgba(148,163,184,.35)">
          <div class="card-title">Резултат от пробата <span class="pill pill-dim">HTTP ${num(r.status)}</span></div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;margin-top:8px">
            ${r.found?.imageUrl ? `<img src="${esc(r.found.imageUrl)}" style="width:120px;height:120px;object-fit:cover;border-radius:10px" loading="lazy">` : ''}
            <div style="flex:1;min-width:240px">
              <div style="font-weight:800;font-size:15px">${esc(r.found?.title || '(няма заглавие)')}</div>
              <div style="color:var(--muted);font-size:13.5px;margin:4px 0">
                Цена: <strong>${r.found?.price ? money(r.found.price) : '—'}</strong>
                · открито чрез: <strong>${esc(r.found?.via || '—')}</strong>
                ${r.found?.breadcrumb ? ' · ' + esc(r.found.breadcrumb) : ''}
              </div>
              <div class="hint" style="margin:6px 0 0">${esc((r.found?.description || '').slice(0, 300))}</div>
              <div class="hint" style="margin-top:8px">
                JSON-LD: ${r.hasJsonLd ? '✅' : '—'} · OpenGraph: ${r.hasOpenGraph ? '✅' : '—'} · Микро-данни: ${r.hasMicrodata ? '✅' : '—'}
                · ${esc(r.hint)}
              </div>
            </div>
          </div>
        </div>`;
    } catch (e) {
      out.innerHTML = `<div class="hint warn">${esc(e.message)}</div>`;
    }
  };

  bindScraperTabs();
  bindScraperAuto();
  bindScraperDiscovery();
  bindScraperEngines(box);

  bindScraperHistory();
  bindScraperStop();
  bindScraperSites();
  bindScraperProgress();
  bindScraperAds();
  bindScraperPlaces();
  bindScraperSchedules();

  if (scraperJobId) await scraperLoadJob();
  else if (running) {
    $('#sc-job').innerHTML = `<div class="card"><div class="hint"><span class="spinner"></span> Има работеща задача — отвори я от историята.</div></div>`;
  }
}


/* ============================================ 🔎 таб „Търси магазини“ ======== */

const SC_TABS = [
  ['auto', '🚀 Автопилот'],
  ['new', '🕸️ Нова обиколка'],
  ['discover', '🔎 Търси магазини'],
  ['live', '🔄 Вървящи'],
  ['sched', '📅 Разписания'],
  ['hist', '🕓 История'],
  ['progress', '📈 Напредък'],
  ['ads', '🏷️ Обяви'],
  ['places', '🏪 Обекти'],
  ['sites', '🌐 Сайтове'],
  ['engines', '🔧 Двигатели'],
];
const SC_PANES = {
  auto: 'sc-pane-auto',
  new: 'sc-pane-new',
  discover: 'sc-pane-discover',
  live: 'sc-pane-live',
  sched: 'sc-pane-sched',
  hist: 'sc-pane-hist',
  progress: 'sc-pane-progress',
  ads: 'sc-pane-ads',
  places: 'sc-pane-places',
  sites: 'sc-pane-sites',
  engines: 'sc-pane-engines',
};

/** Табовете на секцията. Ако има чакащи заявки за домашния робот, се виждат. */
/* ============================================ 🚀 таб „Автопилот“ ============ */

const AU_ACTION = {
  schedule: ['✅ Разписано', 'pill-green'],
  already: ['✅ Вече беше разписано', 'pill-dim'],
  robot: ['🖥️ Домашен робот', 'pill-gold'],
  skipped: ['⛔ robots.txt', 'pill-dim'],
  failed: ['❌ Не става', 'pill-red'],
};

/**
 * Автопилотът: даваш САМО имената на сайтовете — системата проверява, решава,
 * разписва и проучва сама. Нищо ръчно.
 */
function scraperAutoHtml(a) {
  const st = (a && a.stats) || {};
  const d = (a && a.defaults) || {};
  const items = (a && a.items) || [];
  const pending = (a && a.pending) || 0;

  return `
    <div class="card" style="border-color:rgba(34,211,238,.55)">
      <div class="card-title">🚀 Автопилот <span class="muted">— дай само имената на сайтовете, другото е наше</span></div>

      <div class="hint" style="margin:6px 0 12px;line-height:1.7">
        Напиши домейните (по един на ред, колкото искаш). Системата сама:
        <br>1️⃣ проверява дали сайтът може да се чете (сървър / Cloudflare / забрана в robots.txt);
        <br>2️⃣ уважава <b>robots.txt</b> — ако сайтът забранява на ботове, НЕ го пипаме (това пази и нас, и сайта);
        <br>3️⃣ прави <b>учтиво разписание</b>: по малко на ден, на случайни моменти, 25-мин паузи, различен вход всеки път;
        <br>4️⃣ пуска <b>една проучвателна обиколка</b> (само чете — нищо не внася), за да разбере колко продукта има сайтът;
        <br>5️⃣ смята квотата така, че <b>целият сайт да се обходи за ~${num(d.days || 14)} дни</b>, и слага таван — после спира сам;
        <br>6️⃣ ако сайтът не пуска сървъра → отива автоматично при <b>домашния робот</b>.
      </div>

      <label class="field full"><span>Адреси на сайтове — по един на ред</span>
        <textarea id="au-sites" rows="5" placeholder="magazin.bg&#10;drug-magazin.com&#10;https://treti.bg/kategoriya"></textarea></label>

      <div class="form-grid" style="margin-top:10px">
        <label class="field"><span>Какво да прави</span>
          <select id="au-mode">
            <option value="import" selected>Внасяй веднага (сам, без въпроси)</option>
            <option value="preview">Първо ми покажи (само събира, не внася)</option>
          </select></label>
        <label class="field" style="max-width:230px"><span>Колко продукта на ден (0 = сам да реши)</span>
          <input id="au-quota" type="number" min="0" max="2000" value="0"></label>
        <label class="field" style="max-width:280px"><span>Учтивост</span>
          <select id="au-robots">
            <option value="1" selected>Спазвай robots.txt (правилното)</option>
            <option value="0">Пренебрегни robots.txt (само ако имаш разрешение)</option>
          </select></label>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center">
        <button class="btn btn-primary" id="au-run">🚀 Пусни автопилота</button>
        ${pending ? `<button class="btn" id="au-continue">▶ Продължи с оставащите (${num(pending)})</button>` : ''}
        <span class="hint" style="margin:0">Проверява до ${num(d.batch || 25)} сайта наведнъж — останалите чакат ред и се помнят.</span>
      </div>
      <div id="au-out" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <div class="card-title">📊 Сайтове в автопилота <span class="muted">— какво е решено и как върви</span></div>
      <div class="grid grid-4" style="margin-bottom:10px">
        <div class="card kpi" style="margin:0"><div class="kpi-label">Сайтове общо</div><div class="kpi-value cyan">${num(st.total)}</div><div class="kpi-sub">в автопилота</div></div>
        <div class="card kpi" style="margin:0"><div class="kpi-label">Разписани</div><div class="kpi-value gold">${num(st.scheduled)}</div><div class="kpi-sub">внасят сами</div></div>
        <div class="card kpi" style="margin:0"><div class="kpi-label">Домашен робот</div><div class="kpi-value">${num(st.robot)}</div><div class="kpi-sub">чакат 10:15 / 20:15</div></div>
        <div class="card kpi" style="margin:0"><div class="kpi-label">Прескочени / не стават</div><div class="kpi-value">${num(st.skipped)} / ${num(st.failed)}</div><div class="kpi-sub">с причина по-долу</div></div>
      </div>
      ${
        items.length
          ? `<div class="table-wrap"><table>
        <thead><tr><th>Сайт</th><th>Какво реши</th><th>Размер на сайта</th><th>Квота/ден</th><th>Днес</th><th>Внесени</th><th>Следващо</th><th>Състояние</th><th></th></tr></thead>
        <tbody>
          ${items
            .map((r) => {
              const [label, cls] = AU_ACTION[r.action] || ['—', 'pill-dim'];
              const size = r.catalog_size == null ? '<span class="muted">проучва…</span>' : `${num(r.catalog_size)} продукта`;
              const next = r.next_run_at ? whenShort(r.next_run_at) : '—';
              const state = r.auto_stopped_at
                ? '<span class="hint">спря се сам (изчерпан)</span>'
                : r.enabled === false
                  ? '<span class="hint">изключено</span>'
                  : r.last_status
                    ? esc(String(r.last_status))
                    : '<span class="hint">чака</span>';
              return `<tr>
              <td><b>${esc(r.domain)}</b><div class="hint" style="margin:0">${esc(r.strategy || r.platform || '')}</div></td>
              <td><span class="pill ${cls}">${esc(label)}</span></td>
              <td>${size}</td>
              <td>${r.quota == null ? '—' : num(r.quota)}</td>
              <td>${r.used_today == null ? '—' : num(r.used_today)}</td>
              <td><b>${num(r.total_imported)}</b><div class="hint" style="margin:0">обходени ${num(r.total_crawled)}</div></td>
              <td class="muted">${esc(next)}</td>
              <td class="muted">${state}</td>
              <td class="actions">
                <button class="btn btn-sm btn-ghost" data-au-measure="${esc(r.domain)}" title="Премери каталога наново от продуктовата карта">📏</button>
                <button class="btn btn-sm btn-ghost" data-au-forget="${esc(r.domain)}" title="Махни реда">✕</button>
              </td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table></div>
      <div class="hint" style="margin-top:8px">„✕“ маха реда от този списък — разписанието остава (то се управлява от таб 📅 Разписания).</div>`
          : '<div class="hint">Още нищо не е добавено. Сложи домейни горе и натисни „Пусни автопилота“.</div>'
      }
    </div>`;
}

function bindScraperAuto() {
  const box = document.getElementById('au-out');
  const send = async (extra) => {
    const sites = (document.getElementById('au-sites') || {}).value || '';
    if (!sites.trim()) return toast('Дай поне един адрес', 'warn');
    const btn = document.getElementById('au-run');
    if (btn) btn.disabled = true;
    if (box)
      box.innerHTML = '<div class="hint"><span class="spinner"></span> Проверявам сайтовете и решавам какво да правя с всеки. Това прави истински заявки — може да отнеме до минута.</div>';
    try {
      const r = await api('/scraper/autopilot', {
        method: 'POST',
        body: {
          sites,
          mode: (document.getElementById('au-mode') || {}).value || 'import',
          respectRobots: ((document.getElementById('au-robots') || {}).value || '1') === '1',
          dailyQuota: Number((document.getElementById('au-quota') || {}).value) || 0,
          ...(extra || {}),
        },
      });

      const rows = (r.items || [])
        .map((i) => {
          const [label, cls] = AU_ACTION[i.action] || ['—', 'pill-dim'];
          return `<tr><td><b>${esc(i.domain)}</b></td><td><span class="pill ${cls}">${esc(label)}</span></td>
            <td class="muted">${esc(i.strategy || i.platform || '—')}</td>
            <td>${i.productsFound ? num(i.productsFound) + ' в пробата' : '—'}</td>
            <td>${esc(i.reason)}</td></tr>`;
        })
        .join('');

      if (box) {
        box.innerHTML = `
          <div class="card" style="border-color:rgba(74,222,128,.45)">
            <div class="card-title">Резултат <span class="pill pill-green">${num(r.checked)} проверени</span>
              ${r.createdSchedules ? `<span class="pill pill-green">${num(r.createdSchedules)} разписани</span>` : ''}
              ${r.robotQueued ? `<span class="pill pill-gold">${num(r.robotQueued)} за домашния робот</span>` : ''}
              ${r.skippedRobots ? `<span class="pill pill-dim">${num(r.skippedRobots)} прескочени (robots)</span>` : ''}
            </div>
            <div class="table-wrap" style="margin-top:8px"><table>
              <thead><tr><th>Сайт</th><th>Какво направих</th><th>Стратегия</th><th>Проба</th><th>Защо</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5" class="hint">Нищо не е проверено.</td></tr>'}</tbody>
            </table></div>
            ${r.note ? `<div class="hint warn" style="margin-top:8px">${esc(r.note)}</div>` : ''}
            ${r.remaining ? `<div class="hint" style="margin-top:6px">Остават ${num(r.remaining)} сайта — натисни „Продължи с оставащите“.</div>` : ''}
          </div>`;
      }
      toast(`Автопилот: ${r.checked} проверени, ${r.createdSchedules} разписани`);
      // Презареждаме таба, за да се видят новите сайтове в списъка.
      setTimeout(() => render('scraper', true), 1200);
    } catch (e) {
      if (box) box.innerHTML = `<div class="hint warn">${esc(e.message)}</div>`;
      toast(e.message, 'error');
    }
    if (btn) btn.disabled = false;
  };

  const run = document.getElementById('au-run');
  if (run) run.onclick = () => send();
  const cont = document.getElementById('au-continue');
  if (cont) cont.onclick = () => send({ sites: '', limit: 25 });

  document.querySelectorAll('[data-au-measure]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = '⏳';
      try {
        const r = await api('/scraper/autopilot/remeasure', { method: 'POST', body: { domain: b.dataset.auMeasure } });
        toast(
          r.catalogSize
            ? `${b.dataset.auMeasure}: ~${num(r.catalogSize)} продукта → ${num(r.quota)}/ден (за ~${num(r.days)} дни)`
            : 'Не намерих продуктова карта на този сайт'
        );
      } catch (e) {
        toast(e.message, 'error');
      }
      render('scraper', true);
    };
  });

  document.querySelectorAll('[data-au-forget]').forEach((b) => {
    b.onclick = async () => {
      await api('/scraper/autopilot/forget', { method: 'POST', body: { domain: b.dataset.auForget } }).catch(() => undefined);
      render('scraper', true);
    };
  });
}

function scraperTabsHtml(queuePending) {
  return `<div class="sc-tabs">${SC_TABS.map(([id, label]) => {
    const cnt =
      id === 'discover' && queuePending ? ` <span class="sc-tab-badge">🖥️ ${num(queuePending)}</span>` : '';
    return `<button type="button" class="sc-tab${scActiveTab === id ? ' active' : ''}" data-tab="${id}">${esc(label)}${cnt}</button>`;
  }).join('')}</div>`;
}

/** Превключва таб (без да пипа адреса — рутерът не бива да се чупи). */
function scSwitchTab(name) {
  if (!SC_PANES[name]) name = 'new';
  scActiveTab = name;
  document.querySelectorAll('.sc-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.sc-pane').forEach((p) => p.classList.toggle('active', p.id === SC_PANES[name]));
}

function bindScraperTabs() {
  document.querySelectorAll('.sc-tab').forEach((b) => {
    b.onclick = () => scSwitchTab(b.dataset.tab);
  });
  scSwitchTab(scActiveTab);
}

const SHOP_STATUS = {
  ok: ['Сканируем сега', 'pill-green'],
  robots: ['Само без robots.txt', 'pill-gold'],
  apify: ['Сканируем през Apify', 'pill-cyan'],
  local: ['Иска домашен IP', 'pill-gold'],
  manual: ['Трябват селектори', 'pill-dim'],
  error: ['Не отговаря', 'pill-red'],
  rejected: ['Отхвърлен', 'pill-dim'],
};

/** Един намерен магазин: домейн, присъда, доказателство (примерни продукти) и бутони. */
function scraperCandidateRowHtml(c) {
  const [label, cls] = SHOP_STATUS[c.status] || ['Нов', 'pill-dim'];
  const samples = Array.isArray(c.sample) ? c.sample : [];
  const d = esc(c.domain);

  const thumbs = samples
    .slice(0, 4)
    .map(
      (s) => `
      <a href="${esc(s.url || '#')}" target="_blank" rel="noopener" title="${esc((s.title || '').slice(0, 90))}" class="shop-thumb">
        ${
          s.imageUrl
            ? `<img src="${esc(s.imageUrl)}" loading="lazy" onerror="this.style.visibility='hidden'">`
            : '<div class="shop-thumb-empty"></div>'
        }
        <span>${s.price ? money(s.price) : '—'}</span>
      </a>`
    )
    .join('');

  const btns = [];
  if (c.status === 'ok' || c.status === 'apify') {
    btns.push(`<button class="btn btn-sm btn-primary" data-act="scan" data-domain="${d}">▶ Сканирай сега</button>`);
    btns.push(`<button class="btn btn-sm" data-act="sched" data-domain="${d}">📅 Разписание</button>`);
  }
  if (c.status === 'robots') {
    btns.push(`<button class="btn btn-sm btn-primary" data-act="scan-norobots" data-domain="${d}">▶ Сканирай (без robots.txt)</button>`);
  }
  if (c.status === 'local') {
    btns.push(`<button class="btn btn-sm btn-warn" data-act="queue" data-domain="${d}">🖥️ Обходи от моя компютър</button>`);
  }
  if (c.status === 'manual') {
    btns.push(`<button class="btn btn-sm" data-act="probe" data-domain="${d}">🔍 Проба със селектори</button>`);
    // Сайт, който отговаря, но цените му идват от вътрешно API (bauhaus.bg,
    // emag.bg, jysk.bg, praktis.bg), също може да се обходи от домашния робот.
    btns.push(`<button class="btn btn-sm btn-warn" data-act="queue" data-domain="${d}">🖥️ Обходи от моя компютър</button>`);
  }
  // 🚀 Към автопилота — едно натискане и сайтът влиза в автоматичното сканиране.
  // Системата сама решава дали да го обхожда сървърът (разписание) или домашният
  // робот, и сама смята колко продукта на ден. Вече добавените не се показват
  // като бутон, за да не се пуска едно и също два пъти.
  if (c.status !== 'error' && c.status !== 'rejected') {
    if (c.in_autopilot) {
      const [alabel] = AU_ACTION[c.autopilot_action] || ['🚀 В Автопилота'];
      btns.push(`<span class="pill pill-green" title="Вече е в Автопилота: ${esc(String(alabel))} — виж таб 🚀 Автопилот">🚀 В автопилота</span>`);
    } else if (c.scheduled) {
      btns.push(`<span class="pill pill-green" title="Има включено разписание — виж таб 📅 Разписания">📅 има разписание</span>`);
    } else {
      btns.push(`<button class="btn btn-sm btn-ok" data-act="autopilot" data-domain="${d}" title="Добавя сайта в Автопилота — системата решава сама как да го обхожда">🚀 Към автопилота</button>`);
    }
  }
  btns.push(`<button class="btn btn-sm btn-ghost" data-act="rescan" data-domain="${d}">⟳ Провери пак</button>`);
  btns.push(`<button class="btn btn-sm btn-ghost" data-act="reject" data-domain="${d}">✕ Скрий</button>`);

  return `
    <div class="card shop-row">
      <div class="shop-row-main">
        <div class="shop-row-head">
          <a href="${esc(c.url)}" target="_blank" rel="noopener" class="shop-domain">${d}</a>
          <span class="pill ${cls}">${esc(label)}</span>
          ${c.platform && c.platform !== 'other' ? `<span class="pill pill-dim">${esc(c.platform)}</span>` : ''}
          ${c.strategy ? `<span class="pill pill-cyan">${esc(c.strategy)}</span>` : ''}
          ${c.products_found ? `<span class="pill pill-dim">${num(c.products_found)} продукта</span>` : ''}
        </div>
        ${c.title && c.title !== c.domain && !/^[a-z0-9.-]+$/i.test(c.title) ? `<div class="hint" style="margin:4px 0 0">${esc(c.title)}</div>` : ''}
        <div class="hint" style="margin:6px 0 0">${esc(c.reason || '')}</div>
        <div class="shop-row-actions">${btns.join('')}</div>
      </div>
      ${thumbs ? `<div class="shop-row-thumbs">${thumbs}</div>` : ''}
    </div>`;
}

/** Списъкът с намерени магазини — групиран по присъда, за да се вижда кои стават. */
function scraperCandidatesHtml(items, queue, apify) {
  const list = items || [];
  const q = queue || {};
  const ap = apify || {};
  const apifyLine = ap.limit
    ? `<span class="pill pill-cyan" title="Дневен лимит за Apify — скенерът спира сам, когато го стигне">☁️ Apify днес: $${Number(ap.spentToday || 0).toFixed(3)} / $${Number(ap.limit).toFixed(2)} · месец $${Number(ap.spentMonth || 0).toFixed(2)}</span>`
    : ap.ready === false
      ? `<span class="pill pill-dim">Apify: няма токен</span>`
      : '';
  const ok = list.filter((c) => c.status === 'ok' || c.status === 'robots' || c.status === 'apify');
  const loc = list.filter((c) => c.status === 'local');
  const rest = list.filter(
    (c) => c.status !== 'ok' && c.status !== 'local' && c.status !== 'robots' && c.status !== 'apify'
  );

  const head = `<div class="hint" style="margin:0 0 10px">
    ${
      list.length
        ? `Проверени <strong>${num(list.length)}</strong> · сканируеми сега <strong style="color:#86EFAC">${num(ok.length)}</strong>` +
          (loc.length ? ` · за моя компютър <strong style="color:#FCD34D">${num(loc.length)}</strong>` : '')
        : 'Още нищо не е търсено. Напиши ключова дума горе и натисни „Търси и провери“.'
    }
    ${q.pending ? ` · 🖥️ чакат моя компютър: <strong>${num(q.pending)}</strong>` : ''}
    ${apifyLine ? ` ${apifyLine}` : ''}
  </div>`;

  if (!list.length) return head;

  const sec = (title, arr, pill) =>
    arr.length
      ? `<div style="margin-top:12px">
           <div class="card-title" style="margin-bottom:8px">${esc(title)} <span class="pill ${pill}">${num(arr.length)}</span></div>
           ${arr.map(scraperCandidateRowHtml).join('')}
         </div>`
      : '';

  return (
    head +
    sec('✅ Стават веднага от сървъра', ok, 'pill-green') +
    sec('🖥️ През моя компютър (сайтът не пуска сървъра)', loc, 'pill-gold') +
    sec('🧩 Не станаха автоматично', rest, 'pill-dim')
  );
}

/** Самият таб: търсене по ключова дума + проверка на дадени адреси. */
function scraperDiscoverHtml(items, queue, apify) {
  return `
    <div class="card" style="border-color:rgba(251,191,36,.45)">
      <div class="card-title">🔎 Търси магазини, които стават за сканиране</div>
      <div class="hint" style="margin:6px 0 12px">
        Напиши <strong>ключова дума</strong> — системата намира магазините в мрежата и <strong>проверява всеки</strong>
        (Shopify / WooCommerce каталог, sitemap, продуктови карти в листинга). Показваме само тези, които наистина могат да се
        обходят, <strong>с примерни продукти като доказателство</strong>. Ако сайтът не пуска сървъра (Cloudflare / бот-защита),
        отива при <strong>домашния робот</strong> — обхожда се от твоя компютър, а не от датацентъра.
      </div>
      <div class="form-grid">
        <label class="field full"><span>Ключови думи</span>
          <input id="sd-q" placeholder="био козметика, кафе на зърна, спортни стоки, храни за кучета…"></label>
        <label class="field" style="max-width:180px"><span>Колко сайта да провери</span>
          <input id="sd-limit" type="number" min="1" max="25" value="8"></label>
        <label class="field" style="max-width:200px"><span>Колко продукта при обиколка</span>
          <input id="sd-count" type="number" min="1" max="2000" value="20"></label>
        <label class="field" style="max-width:280px"><span>Повторна проверка</span>
          <select id="sd-force">
            <option value="0">Не — ползвай проверените до 12 ч</option>
            <option value="1">Да — провери всички наново</option>
          </select></label>
        <label class="field full"><span>…или дай адреси сам (по един на ред)</span>
          <textarea id="sd-domains" rows="2" placeholder="magazin.bg&#10;drug-magazin.com"></textarea></label>
      </div>
      <div class="shop-row-actions" style="margin-top:10px">
        <button class="btn btn-primary" id="sd-run">🔎 Търси и провери</button>
        <button class="btn" id="sd-bulk" title="Задай разписание за всички намерени сканируеми магазини">📅 Разписание за всички сканируеми</button>
        <span class="hint" style="margin:0">Проверката прави истински заявки към сайтовете — учтива е и помни резултата 12 часа.</span>
      </div>
      <div id="sd-out" style="margin-top:12px">${scraperCandidatesHtml(items, queue, apify)}</div>
    </div>`;
}

function bindScraperDiscovery() {
  const out = $('#sd-out');
  const runBtn = $('#sd-run');

  if (runBtn) {
    runBtn.onclick = async () => {
      const q = ($('#sd-q').value || '').trim();
      const domains = ($('#sd-domains').value || '')
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!q && !domains.length) return toast('Дай ключова дума или поне един адрес', 'warn');

      runBtn.disabled = true;
      const old = runBtn.textContent;
      runBtn.textContent = 'Търся и проверявам…';
      out.innerHTML = `<div class="hint"><span class="spinner"></span> Търся магазини и проверявам кой става за сканиране.
        Това прави по няколко заявки към всеки сайт — може да отнеме до минута.</div>`;
      try {
        const body = { limit: Number($('#sd-limit').value) || 8, force: $('#sd-force').value === '1' };
        if (domains.length) body.domains = domains;
        else body.query = q;
        const r = await api('/scraper/discover', { method: 'POST', body });
        const okN = (r.items || []).filter((i) => i.status === 'ok').length;
        const locN = (r.items || []).filter((i) => i.status === 'local').length;
        toast(`Проверени ${r.checked} · сканируеми ${okN}${locN ? ` · за моя компютър ${locN}` : ''}`);
        if (r.note) toast(r.note, 'warn');
        out.innerHTML = scraperCandidatesHtml(r.items || [], r.queue || {}, r.apify || {});
      } catch (e) {
        out.innerHTML = `<div class="hint warn">${esc(e.message)}</div>`;
      }
      runBtn.disabled = false;
      runBtn.textContent = old;
    };
  }

  if (out) {
    out.onclick = async (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const domain = btn.dataset.domain;
      const act = btn.dataset.act;
      const countEl = $('#sd-count');
      const count = Number(countEl ? countEl.value : 20) || 20;
      btn.disabled = true;
      try {
        if (act === 'scan' || act === 'scan-norobots') {
          const body = { count };
          // Сайт, който забранява на ботове в robots.txt, минава само с тази отметка.
          if (act === 'scan-norobots') body.options = { respectRobots: false };
          const r = await api(`/scraper/candidates/${encodeURIComponent(domain)}/scan`, {
            method: 'POST',
            body,
          });
          toast(`Обиколката тръгна: ${r.domain}`);
          scraperJobId = r.jobId;
          await render('scraper', true);
          scSwitchTab('live');
          return;
        }

        if (act === 'sched') {
          await openScraperSchedulesFor(`https://${domain}/`);
          return;
        }

        if (act === 'queue') {
          await api('/scraper/local-queue', { method: 'POST', body: { domain, count } });
          toast(`Добавено в опашката за моя компютър: ${domain}`);
          btn.textContent = '✅ В опашката';
          return;
        }

        if (act === 'probe') {
          scSwitchTab('new');
          const u = $('#sc-url');
          if (u) u.value = `https://${domain}/`;
          const p = $('#sc-probe');
          if (p) p.click();
          return;
        }

        if (act === 'autopilot') {
          // Едно натискане: проверява сайта и го добавя в Автопилота (разписание
          // или домашен робот). Показваме какво реши системата и с колко на ден.
          btn.textContent = '…добавям в автопилота';
          const r = await api('/scraper/autopilot', { method: 'POST', body: { sites: domain, mode: 'import' } });
          const it = (r.items || [])[0] || {};
          const [label] = AU_ACTION[it.action] || ['—'];
          toast(`Автопилот: ${domain} → ${label}${it.quota ? ` · до ${num(it.quota)} на ден` : ''}`);
          if (it.reason) toast(it.reason, 'warn');
          const fresh = await api('/scraper/candidates?limit=40');
          out.innerHTML = scraperCandidatesHtml(fresh.items || [], fresh.queue || {}, fresh.apify || {});
          return;
        }

        if (act === 'rescan') {
          toast(`Проверявам пак ${domain}…`);
          const r = await api(`/scraper/candidates/${encodeURIComponent(domain)}/rescan`, { method: 'POST' });
          const fresh = await api('/scraper/candidates?limit=40');
          out.innerHTML = scraperCandidatesHtml(fresh.items || [], fresh.queue || {}, fresh.apify || {});
          const first = (r.items || [])[0];
          toast(`Готово: ${first ? first.status : '—'}${first && first.reason ? ` — ${first.reason.slice(0, 60)}` : ''}`);
          return;
        }

        if (act === 'reject') {
          await api(`/scraper/candidates/${encodeURIComponent(domain)}/reject`, { method: 'POST' });
          const row = btn.closest('.shop-row');
          if (row) row.remove();
          toast(`Скрит: ${domain}`);
          return;
        }
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        btn.disabled = false;
      }
    };
  }

  const bulk = $('#sd-bulk');
  if (bulk) {
    bulk.onclick = async () => {
      const doms = Array.from(document.querySelectorAll('#sd-out button[data-act="scan"]')).map(
        (b) => `https://${b.dataset.domain}/`
      );
      if (!doms.length) return toast('Няма сканируеми магазини в списъка', 'warn');
      await openScraperSchedulesFor(doms.join('\n'));
    };
  }
}

/** Отваря таба с разписанията, предварително попълнен с тези адреси. */
async function openScraperSchedulesFor(urls) {
  bulkPrefill = urls;
  scSwitchTab('sched');
  const b = document.getElementById('sc-sched-bulk');
  if (b) b.click();
  else toast('Формата за разписания не е налична — презареди страницата', 'warn');
}

/** Едновременно вървящите задачи — може да има няколко, за различни сайтове. */
function scraperRunningHtml(items) {
  if (!items.length) return '';
  return `
    <div class="card" style="border-color:rgba(6,182,212,.45)">
      <div class="card-title"><span class="spinner"></span> Вървят сега <span class="pill pill-dim">${num(items.length)}</span></div>
      <div class="table-wrap" style="margin-top:8px">
        <table>
          <thead><tr><th>Сайт</th><th>Състояние</th><th>От</th><th>Прочетени</th><th>Внесени</th><th>Обходени</th><th></th></tr></thead>
          <tbody>
            ${items
              .map(
                (j) => `<tr>
              <td><strong>${esc(j.domain)}</strong><div class="hint" style="margin:0">${j.source_kind === 'schedule' ? 'по разписание' : 'ръчно'} · ${esc(SCRAPE_STATUS_LABELS[j.status] || j.status)}</div></td>
              <td>${j.mode === 'import' ? 'внася' : 'преглед'}${j.strategy ? ` · ${esc(j.strategy)}` : ''}</td>
              <td>${ago(j.created_at)}</td>
              <td>${num(j.parsed)}/${num(j.target_count)}</td>
              <td>${num(j.imported)}</td>
              <td>${num(j.pages_visited)}</td>
              <td class="actions">
                <button class="btn btn-sm btn-danger" data-sc-stop="${esc(j.id)}">⏹ Спри</button>
                <button class="btn btn-sm btn-ghost" data-sc-open="${esc(j.id)}">Отвори</button>
              </td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Разписанията — сърцето на „да не заливаме сайта“.
 *
 * Пример: 20 продукта на ден, групи по 3–6, активни 8–22 ч. Системата сама
 * избира случаен момент за всяко пускане, така че 20-те продукта се разпределят
 * на 4–6 посещения през деня, а не 20 заявки за две минути.
 */
function scraperSchedulesHtml(items) {
  const form = `
    <div class="hint" style="margin:6px 0 12px">
      Разписанието пуска само̀ обиколки през деня, за да не заливаме магазина.
      Дай <strong>дневна квота</strong> (напр. 20 продукта), <strong>групи по</strong> 3–6 и
      <strong>активни часове</strong> — моментите се избират случайно вътре в тях.
    </div>`;

  if (!items.length) {
    return `<div class="card">${`<div class="card-title">📅 Разписания и дневен лимит</div>`}${form}
      <div class="hint">Още няма разписание. Добави едно и сайтът ще се пълни сам, без да пречи.</div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="sc-sched-add">+ Ново разписание</button>
        <button class="btn" id="sc-sched-bulk">➕ Добави няколко сайта</button>
      </div>
    </div>`;
  }

  return `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span>📅 Разписания и дневен лимит <span class="pill pill-dim">${num(items.length)}</span></span>
        <span style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary" id="sc-sched-add">+ Ново разписание</button>
          <button class="btn btn-sm" id="sc-sched-bulk">➕ Няколко сайта</button>
          <button class="btn btn-sm btn-ghost" id="sc-sched-allon">▶ Пусни всички</button>
          <button class="btn btn-sm btn-ghost" id="sc-sched-alloff">⏸ Пауза всички</button>
        </span>
      </div>
      ${form}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Сайт</th><th>Квота/ден</th><th>Група</th><th>Активни часове</th><th>Днес</th><th>Следващо пускане</th><th>Общо внесени</th><th>Обходени</th><th>Състояние</th><th></th></tr></thead>
          <tbody>
            ${items
              .map(
                (s) => `<tr>
              <td><strong>${esc(s.label || s.domain)}</strong><div class="hint" style="margin:0">${esc(s.domain)}</div></td>
              <td><strong>${num(s.daily_quota)}</strong>${s.max_total ? `<div class="hint" style="margin:0">таван ${num(s.max_total)}</div>` : ''}</td>
              <td>${num(s.burst_min)}–${num(s.burst_max)}</td>
              <td>${String(s.hour_from).padStart(2, '0')}:00–${String(s.hour_to).padStart(2, '0')}:00<div class="hint" style="margin:0">пауза ≥ ${num(s.min_gap_min)} мин</div></td>
              <td><strong>${num(s.used_today)}</strong>/${num(s.daily_quota)}<div class="hint" style="margin:0">${num(s.runs_today)} пускания</div></td>
              <td>${s.enabled ? (s.running > 0 ? '<span class="spinner"></span> върви сега' : s.next_run_at ? ago(s.next_run_at) === 'сега' ? 'сега' : 'след ' + ago(s.next_run_at) : '—') : '<span class="pill pill-dim">спряно</span>'}</td>
              <td>${num(s.total_imported)}<div class="hint" style="margin:0">${num(s.total_jobs)} обиколки</div></td>
              <td>${num(s.total_crawled)} стр.</td>
              <td>${
                s.auto_stopped_at
                  ? `<span class="pill" style="background:rgba(251,191,36,.18);color:#FBBF24">⏹ спря се сам</span>`
                  : s.enabled
                    ? `<span class="pill" style="background:rgba(34,197,94,.16);color:#34D399">включено</span>`
                    : '<span class="pill pill-dim">пауза</span>'
              }${s.last_message ? `<div class="hint" style="margin:0;max-width:220px">${esc(s.last_message)}</div>` : ''}</td>
              <td class="actions">
                <button class="btn btn-sm btn-ok" data-sc-sched-run="${esc(s.id)}">Пусни сега</button>
                <button class="btn btn-sm btn-ghost" data-sc-sched-edit="${esc(s.id)}">Редакция</button>
                <button class="btn btn-sm btn-ghost" data-sc-sched-stats="${esc(s.domain)}">Статистика</button>
                <button class="btn btn-sm btn-ghost" data-sc-sched-toggle="${esc(s.id)}" data-on="${s.enabled ? '1' : '0'}">${s.enabled ? '⏸ Пауза' : '▶ Пусни'}</button>
                <button class="btn btn-sm btn-danger" data-sc-sched-del="${esc(s.id)}">Изтрий</button>
              </td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function bindScraperSchedules() {
  // Настройките от последната ръчна задача — за да не се въвеждат пак.
  const lastOpts = scraperLastForm ?? {};
  const openSchedForm = (s) =>
    openModal(
      s ? 'Редакция на разписание' : 'Ново разписание',
      `
      <div class="hint" style="margin-bottom:10px">Квотата се разпределя на групи през активните часове, на случаен интервал. Така сайтът вижда нормален трафик, а не 20 заявки за минута.</div>
      <label class="field full"><span>Адрес на магазина / категорията <span class="hint" style="margin:0">(може няколко — по един на ред)</span></span>
        <input id="sch-url" placeholder="https://magazin.bg/kategoriya" value="${esc(s?.url || '')}"></label>
      <div class="form-grid" style="margin-top:8px">
        <label class="field"><span>Име (за теб)</span><input id="sch-label" value="${esc(s?.label || '')}"></label>
        <label class="field"><span>Колко продукта на ден</span><input id="sch-quota" type="number" min="1" max="2000" value="${Number(s?.daily_quota ?? 20)}"></label>
        <label class="field"><span>Група от</span><input id="sch-bmin" type="number" min="1" max="200" value="${Number(s?.burst_min ?? 3)}"></label>
        <label class="field"><span>Група до</span><input id="sch-bmax" type="number" min="1" max="200" value="${Number(s?.burst_max ?? 6)}"></label>
        <label class="field"><span>Активен от (час)</span><input id="sch-hf" type="number" min="0" max="23" value="${Number(s?.hour_from ?? 8)}"></label>
        <label class="field"><span>Активен до (час)</span><input id="sch-ht" type="number" min="1" max="24" value="${Number(s?.hour_to ?? 22)}"></label>
        <label class="field"><span>Мин. пауза между пускания (мин)</span><input id="sch-gap" type="number" min="0" max="1440" value="${Number(s?.min_gap_min ?? 20)}"></label>
        <label class="field"><span>Макс. общо продукти (0 = без таван)</span><input id="sch-maxtotal" type="number" min="0" max="100000" value="${Number(s?.max_total ?? 0)}"></label>
        <label class="field"><span>Какво да прави</span>
          <select id="sch-mode">
            <option value="import"${(s?.mode || 'import') === 'import' ? ' selected' : ''}>Внасяй директно</option>
            <option value="preview"${s?.mode === 'preview' ? ' selected' : ''}>Само показвай (преглед)</option>
          </select></label>
        <label class="field"><span>Състояние</span>
          <select id="sch-enabled">
            <option value="1"${s?.enabled !== false ? ' selected' : ''}>Включено</option>
            <option value="0"${s?.enabled === false ? ' selected' : ''}>Изключено</option>
          </select></label>
      </div>
      <div style="margin-top:12px;padding:12px;border:1px solid rgba(148,163,184,.18);border-radius:12px">
        <div style="font-weight:600;font-size:14px;margin-bottom:8px">⚙️ Същите настройки като при ръчна задача</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sch-robots"${lastOpts.respectRobots === false ? '' : ' checked'}> Спазвай robots.txt</label>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sch-ai"${lastOpts.useAi !== false ? ' checked' : ''}> AI обработка</label>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sch-img"${lastOpts.downloadImages ? ' checked' : ''}> Сваляй снимките</label>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sch-skipimg"${lastOpts.skipWithoutImage !== false ? ' checked' : ''}> Без снимка → пропусни</label>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sch-tag"${lastOpts.addShopTag !== false ? ' checked' : ''}> Етикет на магазина</label>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sch-stopdone"${s?.stop_when_done !== false ? ' checked' : ''}> Спри сам, като свърши сайтът</label>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sch-rotate"${s?.rotate !== false ? ' checked' : ''}> Различен вход всеки път</label>
        </div>
        <div class="form-grid" style="margin-top:10px">
          <label class="field"><span>Мин. цена (€)</span><input id="sch-minp" type="number" min="0" step="0.01" value="${lastOpts.minPrice ?? ''}"></label>
          <label class="field"><span>Макс. цена (€)</span><input id="sch-maxp" type="number" min="0" step="0.01" value="${lastOpts.maxPrice ?? ''}"></label>
          <label class="field"><span>Град</span><input id="sch-city" value="${esc(lastOpts.city ?? '')}"></label>
          <label class="field"><span>Категория</span>
            <select id="sch-cat">
              <option value="ai"${lastOpts.categoryMode !== 'breadcrumb' && lastOpts.categoryMode !== 'fixed' ? ' selected' : ''}>AI избира</option>
              <option value="breadcrumb"${lastOpts.categoryMode === 'breadcrumb' ? ' selected' : ''}>От навигацията на сайта</option>
            </select></label>
          <label class="field"><span>Дедупликация</span>
            <select id="sch-dedupe">
              <option value="url"${lastOpts.dedupe !== 'title' && lastOpts.dedupe !== 'off' ? ' selected' : ''}>По адрес</option>
              <option value="title"${lastOpts.dedupe === 'title' ? ' selected' : ''}>По заглавие</option>
              <option value="off"${lastOpts.dedupe === 'off' ? ' selected' : ''}>Без</option>
            </select></label>
        </div>
      </div>`,
      [
        {
          id: 'sch-save',
          label: s ? 'Запази' : 'Създай',
          cls: 'btn-primary',
          onClick: async () => {
            const posOrUndef = (sel) => {
              const v = Number($(sel).value);
              return Number.isFinite(v) && v > 0 ? v : undefined;
            };
            const body = {
              url: $('#sch-url').value.trim(),
              label: $('#sch-label').value.trim() || undefined,
              dailyQuota: Number($('#sch-quota').value),
              burstMin: Number($('#sch-bmin').value),
              burstMax: Number($('#sch-bmax').value),
              hourFrom: Number($('#sch-hf').value),
              hourTo: Number($('#sch-ht').value),
              minGapMin: Number($('#sch-gap').value),
              mode: $('#sch-mode').value,
              enabled: $('#sch-enabled').value === '1',
              maxTotal: Number($('#sch-maxtotal').value) || 0,
              stopWhenDone: $('#sch-stopdone').checked,
              rotate: $('#sch-rotate').checked,
              options: {
                respectRobots: $('#sch-robots').checked,
                useAi: $('#sch-ai').checked,
                downloadImages: $('#sch-img').checked,
                skipWithoutImage: $('#sch-skipimg').checked,
                addShopTag: $('#sch-tag').checked,
                minPrice: posOrUndef('#sch-minp'),
                maxPrice: posOrUndef('#sch-maxp'),
                city: $('#sch-city').value.trim() || undefined,
                categoryMode: $('#sch-cat').value || undefined,
                dedupe: $('#sch-dedupe').value || undefined,
              },
            };
            try {
              if (s) await api(`/scraper/schedules/${s.id}`, { method: 'PATCH', body });
              else await api('/scraper/schedules', { method: 'POST', body });
              toast(s ? 'Разписанието е обновено' : 'Разписанието е създадено — ще тръгне само, на случаен момент');
              closeModal();
              render('scraper', true);
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        },
        { id: 'sch-cancel', label: 'Отказ', cls: 'btn-ghost', onClick: closeModal },
      ],
      true
    );

  $('#sc-sched-add')?.addEventListener('click', async () => {
    openSchedForm(null);
  });

  document.querySelectorAll('[data-sc-sched-edit]').forEach((b) => {
    b.onclick = async () => {
      const all = await api('/scraper/schedules');
      const s = (all.items || []).find((x) => x.id === b.dataset.scSchedEdit);
      openSchedForm(s || null);
    };
  });

  document.querySelectorAll('[data-sc-sched-run]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api(`/scraper/schedules/${b.dataset.scSchedRun}/run`, { method: 'POST', body: { force: true } });
        toast('Пуснато');
        scraperJobId = r.jobId;
        await render('scraper', true);
      } catch (e) {
        toast(e.message, 'error');
        b.disabled = false;
      }
    };
  });

  document.querySelectorAll('[data-sc-sched-toggle]').forEach((b) => {
    b.onclick = async () => {
      const on = b.dataset.on === '1';
      await api(`/scraper/schedules/${b.dataset.scSchedToggle}`, { method: 'PATCH', body: { enabled: !on } });
      toast(on ? 'Разписанието е на пауза' : 'Разписанието е включено');
      render('scraper', true);
    };
  });

  /**
   * Добавяне на няколко сайта наведнъж.
   *
   * При 10 магазина добавянето един по един е 10 модала и 10 пъти едни и същи
   * настройки. Тук се подава списък и едни правила за всички — а резултатът казва
   * кой сайт е влязъл и кой е прескочен (за да няма тихо губене).
   */
  const openBulkForm = () =>
    openModal(
      '\u2795 \u041d\u044f\u043a\u043e\u043b\u043a\u043e \u0441\u0430\u0439\u0442\u0430 \u043d\u0430\u0432\u0435\u0434\u043d\u044a\u0436',
      `
      <div class="hint" style="margin-bottom:10px">Всеки адрес на нов ред (до 200). Всеки сайт тръгва на СВОЙ случаен момент в активните часове — не удрят всички наведнъж. Сайтове, които вече имат разписание, се прескачат.</div>
      <label class="field full"><span>Адреси (един на ред)</span>
        <textarea id="blk-urls" rows="8" placeholder="https://magazin1.bg\nhttps://magazin2.bg\nhttps://magazin3.bg/kategoriya">${esc(bulkPrefill)}</textarea></label>
      <div class="form-grid" style="margin-top:10px">
        <label class="field"><span>Колко продукта на ден (за всеки)</span><input id="blk-quota" type="number" min="1" max="2000" value="${Number(lastOpts.__quota ?? 20)}"></label>
        <label class="field" style="max-width:340px"><span>Квота</span>
          <select id="blk-auto">
            <option value="1" selected>🎯 Умна — сам да я сметне (препоръчано)</option>
            <option value="0">Фиксирана — колкото съм написал горе</option>
          </select></label>
        <label class="field"><span>Група от</span><input id="blk-bmin" type="number" min="1" max="200" value="3"></label>
        <label class="field"><span>Група до</span><input id="blk-bmax" type="number" min="1" max="200" value="6"></label>
        <label class="field"><span>Активен от (час)</span><input id="blk-hf" type="number" min="0" max="23" value="8"></label>
        <label class="field"><span>Активен до (час)</span><input id="blk-ht" type="number" min="1" max="24" value="22"></label>
        <label class="field"><span>Мин. пауза (мин)</span><input id="blk-gap" type="number" min="0" max="1440" value="20"></label>
        <label class="field"><span>Макс. общо продукти (0 = без)</span><input id="blk-maxtotal" type="number" min="0" value="0"></label>
        <label class="field"><span>Какво да прави</span>
          <select id="blk-mode"><option value="import">Внасяй директно</option><option value="preview">Само показвай</option></select></label>
        <label class="field"><span>robots.txt</span>
          <select id="blk-robots"><option value="1">Спазвай (правилното)</option><option value="0">Пренебрегни</option></select></label>
        <label class="field"><span>AI обработка</span>
          <select id="blk-ai"><option value="1">Да</option><option value="0">Не</option></select></label>
      </div>`,
      [
        {
          id: 'blk-save',
          label: 'Добави ги',
          cls: 'btn-primary',
          onClick: async () => {
            const urls = $('#blk-urls').value.trim();
            if (!urls) return toast('Въведи поне един адрес', 'error');
            try {
              const r = await api('/scraper/schedules/bulk', {
                method: 'POST',
                body: {
                  urls,
                  dailyQuota: Number($('#blk-quota').value),
                  burstMin: Number($('#blk-bmin').value),
                  burstMax: Number($('#blk-bmax').value),
                  hourFrom: Number($('#blk-hf').value),
                  hourTo: Number($('#blk-ht').value),
                  minGapMin: Number($('#blk-gap').value),
                  // 🎯 Умната квота: системата мери всеки сайт от продуктовата му
                  // карта и смята квота + таван сама (вместо твърдо 20/ден).
                  autoQuota: ($('#blk-auto') || {}).value !== '0',
                  maxTotal: Number($('#blk-maxtotal').value) || 0,
                  mode: $('#blk-mode').value,
                  stopWhenDone: true,
                  rotate: true,
                  options: {
                    respectRobots: $('#blk-robots').value === '1',
                    useAi: $('#blk-ai').value === '1',
                    skipWithoutImage: true,
                    addShopTag: true,
                  },
                },
              });
              const skipped = r.skipped || [];
              if (r.autoQuota) toast('Добавени — меря всеки сайт и слагам умна квота (виж 🚀 Автопилот след минута)');
              toast(`Добавени ${r.created} сайта${skipped.length ? `, \u043f\u0440\u0435\u0441\u043a\u043e\u0447\u0435\u043d\u0438 ${skipped.length}` : ''}`);
              if (skipped.length) {
                openModal(
                  'Прескочени адреси',
                  `<div class="hint" style="margin-bottom:10px">Тези не влязоха — виждаш защо:</div>
                   <ul style="padding-left:18px;color:var(--muted);font-size:13px;line-height:1.8">
                     ${skipped.map((s) => `<li><strong>${esc(s.url)}</strong> — ${esc(s.reason)}</li>`).join('')}
                   </ul>`,
                  [{ id: 'blk-close2', label: 'Ясно', cls: 'btn-primary', onClick: () => { closeModal(); render('scraper', true); } }],
                  true
                );
              } else {
                closeModal();
                render('scraper', true);
              }
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        },
        { id: 'blk-cancel', label: 'Отказ', cls: 'btn-ghost', onClick: closeModal },
      ],
      true
    );

  $('#sc-sched-bulk')?.addEventListener('click', () => openBulkForm());

  /** Пускане/спиране на всички разписания с едно натискане. */
  const setAll = async (enabled) => {
    try {
      const all = await api('/scraper/schedules');
      const items = all.items || [];
      let done = 0;
      for (const s of items) {
        if (s.enabled === enabled) continue;
        await api(`/scraper/schedules/${s.id}`, { method: 'PATCH', body: { enabled } });
        done++;
      }
      toast(enabled ? `Пуснах ${done} разписания` : `Спрях ${done} разписания`);
      render('scraper', true);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#sc-sched-allon')?.addEventListener('click', () => setAll(true));
  $('#sc-sched-alloff')?.addEventListener('click', () =>
    confirmAction({
      title: 'Пауза на всички разписания',
      message: 'Да спра всички разписания? Вече внесеното остава.',
      confirmLabel: 'Спри всички',
      onConfirm: () => setAll(false),
    })
  );

  document.querySelectorAll('[data-sc-sched-del]').forEach((b) => {
    b.onclick = () =>
      confirmAction({
        title: 'Изтриване на разписание',
        message: 'Да изтрия ли разписанието? Вече внесените продукти остават.',
        confirmLabel: 'Изтрий',
        onConfirm: async () => {
          await api(`/scraper/schedules/${b.dataset.scSchedDel}`, { method: 'DELETE' });
          toast('Изтрито');
          closeModal();
          render('scraper', true);
        },
      });
  });

  document.querySelectorAll('[data-sc-sched-stats]').forEach((b) => {
    b.onclick = async () => {
      const domain = b.dataset.scSchedStats;
      openModal(
        `Статистика: ${domain}`,
        '<div id="sc-stats-body"><div class="hint"><span class="spinner"></span> Смятам…</div></div>',
        [{ id: 'sc-stats-close', label: 'Затвори', cls: 'btn-ghost', onClick: closeModal }],
        true
      );
      try {
        const d = await api(`/scraper/sites/${encodeURIComponent(domain)}/stats`);
        const t = d.totals || {};
        $('#sc-stats-body').innerHTML = `
          <div class="grid grid-3" style="gap:10px;margin-bottom:12px">
            <div class="card kpi"><div class="kpi-label">Внесени продукти</div><div class="kpi-value cyan">${num(t.imported)}</div></div>
            <div class="card kpi"><div class="kpi-label">Обходени страници</div><div class="kpi-value gold">${num(t.crawled)}</div><div class="kpi-sub">${num(t.jobs)} обиколки</div></div>
            <div class="card kpi"><div class="kpi-label">Прочетени / пропуснати</div><div class="kpi-value">${num(t.parsed)} / ${num(t.skipped)}</div><div class="kpi-sub">грешки: ${num(t.failed)}</div></div>
          </div>
          <div class="hint" style="margin-bottom:10px">Първа обиколка: ${t.first_run ? dt(t.first_run) : '—'} · Последна: ${t.last_run ? dt(t.last_run) : '—'}
            ${d.site?.strategy ? ` · стратегия: <strong>${esc(d.site.strategy)}</strong>` : ''}</div>
          <div class="card-title" style="margin-top:8px">По дни</div>
          <div class="table-wrap" style="max-height:220px;overflow:auto">
            <table><thead><tr><th>Ден</th><th>Обиколки</th><th>Внесени</th><th>Прочетени</th><th>Обходени стр.</th></tr></thead><tbody>
              ${(d.perDay || [])
                .map((r) => `<tr><td>${esc(r.day)}</td><td>${num(r.jobs)}</td><td><strong>${num(r.imported)}</strong></td><td>${num(r.parsed)}</td><td>${num(r.crawled)}</td></tr>`)
                .join('') || '<tr><td colspan="5" class="hint">още няма</td></tr>'}
            </tbody></table>
          </div>
          <div class="card-title" style="margin-top:12px">Последни обиколки</div>
          <div class="table-wrap" style="max-height:220px;overflow:auto">
            <table><thead><tr><th>Кога</th><th>Вид</th><th>Състояние</th><th>Прочетени</th><th>Внесени</th><th>Обходени</th></tr></thead><tbody>
              ${(d.runs || [])
                .map(
                  (r) => `<tr><td>${dt(r.created_at)}</td><td>${r.source_kind === 'schedule' ? 'разписание' : 'ръчно'}</td>
                  <td>${esc(SCRAPE_STATUS_LABELS[r.status] || r.status)}</td><td>${num(r.parsed)}</td>
                  <td><strong>${num(r.imported)}</strong></td><td>${num(r.pages_visited)}</td></tr>`
                )
                .join('') || '<tr><td colspan="6" class="hint">още няма</td></tr>'}
            </tbody></table>
          </div>`;
      } catch (e) {
        $('#sc-stats-body').innerHTML = `<div class="hint warn">${esc(e.message)}</div>`;
      }
    };
  });
}

function scraperHistoryHtml(items) {
  if (!items.length) return '';
  return `
    <div class="card">
      <div class="card-title">🕐 История на обиколките</div>
      <div class="table-wrap" style="margin-top:10px">
        <table>
          <thead><tr><th>Магазин</th><th>Вид</th><th>Режим</th><th>Състояние</th><th>Открити</th><th>Прочетени</th><th>Обходени</th><th>Внесени</th><th>Пропуснати</th><th>Кога</th><th></th></tr></thead>
          <tbody>
            ${items
              .map(
                (j) => `<tr>
              <td><strong>${esc(j.domain)}</strong><div class="hint" style="margin:0">${esc(String(j.url).slice(0, 46))}</div></td>
              <td>${j.source_kind === 'schedule' ? '<span class="pill pill-dim">разписание</span>' : 'ръчно'}</td>
              <td>${j.mode === 'import' ? 'директно' : 'преглед'}</td>
              <td>${
                ['done'].includes(j.status)
                  ? `<span class="pill" style="background:rgba(34,197,94,.16);color:#34D399">${esc(SCRAPE_STATUS_LABELS[j.status] || j.status)}</span>`
                  : j.status === 'failed'
                    ? `<span class="pill" style="background:rgba(244,63,94,.16);color:#FB7185">счупи се</span>`
                    : `<span class="pill pill-dim">${esc(SCRAPE_STATUS_LABELS[j.status] || j.status)}</span>`
              }</td>
              <td>${num(j.discovered)}</td>
              <td>${num(j.parsed)}</td>
              <td>${num(j.pages_visited)}</td>
              <td>${num(j.imported)}</td>
              <td>${num(j.skipped)}</td>
              <td>${ago(j.created_at)}</td>
              <td class="actions">
                ${
                  ['queued', 'discovering', 'parsing', 'enriching', 'importing'].includes(j.status)
                    ? `<button class="btn btn-sm btn-danger" data-sc-stop="${esc(j.id)}">⏹ Спри</button>`
                    : ''
                }
                <button class="btn btn-sm btn-ghost" data-sc-open="${esc(j.id)}">Отвори</button>
              </td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function bindScraperHistory() {
  document.querySelectorAll('[data-sc-open]').forEach((b) => {
    b.onclick = async () => {
      scraperSelected = new Set();
      scraperJobId = b.dataset.scOpen;
      await scraperLoadJob();
    };
  });
}

/**
 * Спиране на сканиране — отвсякъде в панела.
 *
 * Има го на три места (в „Вървят сега“, в историята и в самата задача), защото
 * човекът не бива да търси къде точно е бутонът, когато нещо е тръгнало.
 */
function bindScraperStop() {
  document.querySelectorAll('[data-sc-stop]').forEach((b) => {
    b.onclick = () =>
      confirmAction({
        title: 'Спиране на сканирането',
        message: 'Да спра ли това сканиране?',
        details: [
          'Спира веднага — следващите продукти не се теглят.',
          'Вече внесеното остава, нищо не се губи.',
          'Разписанието продължава да работи по своя график.',
        ],
        confirmLabel: '⏹ Спри сканирането',
        onConfirm: async () => {
          try {
            await api(`/scraper/jobs/${b.dataset.scStop}/cancel`, { method: 'POST' });
            toast('Сканирането е спряно');
            closeModal();
            render('scraper', true);
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      });
  });
}

function scraperSitesHtml(sites) {
  if (!sites.length) {
    return `<div class="card"><div class="card-title">🧠 Научени сайтове</div><div class="hint" style="margin-top:8px">Още нищо не е научено. След първата успешна обиколка тук ще видиш коя стратегия работи за всеки магазин.</div></div>`;
  }
  return `
    <div class="card">
      <div class="card-title">🧠 Научени сайтове <span class="pill pill-dim">${num(sites.length)}</span></div>
      <div class="hint" style="margin:6px 0 10px">Стратегията се помни — вторият път за същия магазин е един клик. Можеш да добавиш ръчни селектори за упорит сайт.</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Домейн</th><th>Стратегия</th><th>Пускания</th><th>Последно успешно</th><th></th></tr></thead>
          <tbody>
            ${sites
              .map(
                (s) => `<tr>
              <td><strong>${esc(s.domain)}</strong></td>
              <td>${esc(s.strategy || '—')}</td>
              <td>${num(s.runs)}</td>
              <td>${s.last_ok_at ? ago(s.last_ok_at) : '—'}</td>
              <td class="actions">
                <button class="btn btn-sm btn-ghost" data-sc-site="${esc(s.domain)}">Селектори</button>
                <button class="btn btn-sm btn-danger" data-sc-site-del="${esc(s.domain)}">Изтрий</button>
              </td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================ \ud83d\udcc8 таб \u201e\u041d\u0430\u043f\u0440\u0435\u0434\u044a\u043a\u201c ============ */

/**
 * \u201e\u0414\u043e\u043a\u044a\u0434\u0435 \u0441\u043c\u0435 \u0441\u0442\u0438\u0433\u043d\u0430\u043b\u0438\u201c \u2014 \u043f\u043e \u043c\u0430\u0433\u0430\u0437\u0438\u043d (\u043a\u0443\u0440\u0441\u043e\u0440\u044a\u0442 \u043f\u043e\u043c\u043d\u0438 \u043e\u0442\u043a\u044a\u0434\u0435 \u0434\u0430 \u043f\u0440\u043e\u0434\u044a\u043b\u0436\u0438, \u0437\u0430 \u0434\u0430
 * \u043d\u0435 \u0441\u0435 \u0432\u0437\u0438\u043c\u0430\u0442 \u0441\u044a\u0449\u0438\u0442\u0435 \u043f\u0440\u043e\u0434\u0443\u043a\u0442\u0438 \u0432\u0442\u043e\u0440\u0438 \u043f\u044a\u0442) \u0438 \u201e\u043a\u0430\u043a\u0432\u043e \u0435 \u043d\u0430\u0443\u0447\u0438\u043b\u201c \u2014 \u0441\u044a\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u044f\u0442\u0430
 * \u201e\u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f \u043d\u0430 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u0430 \u2192 \u043d\u0430\u0448\u0430 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f\u201c.
 */
/* ============================================ 🏷️ таб „Обяви“ (Apify) ============ */

/**
 * Обяви от сайтовете за обяви през Apify — OLX.bg, imot.bg, Alo.bg.
 *
 * Защо е отделен таб: темите „частни продавачи“, „имоти“ и „авто“ се пълнеха само
 * от Facebook групи. Тези сайтове са истинският пазар на обяви и дават цена, град,
 * снимки и дали продавачът е частно лице или фирма.
 */
/* ============================================ 🏪 таб „Обекти“ (Google Maps) ============ */

/**
 * Обогатяване на обектите през Google Maps.
 *
 * Обектът в SmartPrice (магазин, сервиз, майстор) се ражда от сигналите на
 * хората — знаем само име, град и цени. Google Maps дава рейтинг, брой отзиви,
 * работно време по дни, телефон, сайт, точни координати и квартал.
 */
function scraperPlacesHtml(info) {
  const recent = info.recent || [];
  const apify = info.apify || {};
  // Показваме ДНЕШНОТО работно време, а ако денят не се познае — първия ред.
  const BG_DAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];
  const hours = (h) => {
    if (!Array.isArray(h) || !h.length) return '—';
    const today = BG_DAYS[new Date().getDay()] || '';
    const row =
      h.find((x) => String(x.day || '').toLowerCase().startsWith(today.slice(0, 5)) && today.length > 3) || h[0];
    return row ? `${esc(row.day)}: ${esc(row.hours)}` : '—';
  };
  const budget =
    apify.today !== undefined
      ? `${Number(apify.today).toFixed(2)} / ${Number(apify.limit || 0).toFixed(2)} $`
      : '—';

  return `
    <div class="card">
      <div class="card-title">🏪 Обекти — обогатяване през Google Maps</div>
      <div class="hint" style="margin:6px 0 12px">Всеки обект (магазин, сервиз, майстор) получава рейтинг, брой отзиви, работно време, телефон, сайт и точни координати — така страницата му става полезна, без никой да пише нищо.</div>
      <div class="kpi-row" style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px">
        <div class="card kpi" style="flex:1; min-width:140px"><div class="kpi-label">Обогатени</div><div class="kpi-value cyan">${num(info.enriched)}</div></div>
        <div class="card kpi" style="flex:1; min-width:140px"><div class="kpi-label">Чакат</div><div class="kpi-value gold">${num(info.pending)}</div></div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
        <input id="pl-n" type="number" value="10" min="1" max="50" style="width:84px">
        <button class="btn" id="pl-run">▶ Обогати обектите</button>
        <span class="hint">☁️ Apify днес: ${budget}${apify.allowed === false ? ' · <strong>лимитът е стигнат</strong>' : ''}</span>
      </div>
      <div class="hint" style="margin-top:8px">Работи за 30–90 секунди. Google Maps се таксува на място (≈ $4 / 1000 обекта).</div>
      <div id="pl-out" style="margin-top:12px"></div>
      ${
        recent.length
          ? `<div class="table-wrap" style="margin-top:14px">
              <table>
                <thead><tr><th>Обект</th><th>Град</th><th>Категория</th><th>Рейтинг</th><th>Отзиви</th><th>Работно време</th><th>Карта</th></tr></thead>
                <tbody>${recent
                  .map(
                    (p) => `<tr>
                  <td><strong>${esc(p.place_name)}</strong><div class="hint">${esc((p.address || '').slice(0, 60))}</div></td>
                  <td>${esc(p.city)}</td>
                  <td>${esc(p.category || '—')}</td>
                  <td>${p.rating ? Number(p.rating).toFixed(1) : '—'}${p.rating ? ' ⭐' : ''}</td>
                  <td>${num(p.reviews_count)}</td>
                  <td>${hours(p.hours)}</td>
                  <td>${p.maps_url ? `<a href="${esc(p.maps_url)}" target="_blank" rel="noopener">отвори</a>` : '—'}</td>
                </tr>`
                  )
                  .join('')}</tbody>
              </table>
            </div>`
          : `<div class="hint" style="margin-top:12px">Още няма обогатени обекти.</div>`
      }
    </div>`;
}

/** Бутонът „▶ Обогати обектите“. */
function bindScraperPlaces() {
  const btn = $('#pl-run');
  const out = $('#pl-out');
  if (!btn || !out) return;
  const post = (res) => {
    out.innerHTML = `
      <div class="card" style="border-color:${res.running ? 'rgba(96,165,250,.45)' : res.ok ? 'rgba(34,197,94,.45)' : 'rgba(245,158,11,.45)'}">
        <div class="card-title">${res.running ? '⏳' : res.ok ? '✅' : '⚠️'} ${esc(res.note || '')}</div>
        <div style="margin-top:8px">Питахме за: <strong>${num(res.targeted)}</strong> ·
          намерени в Google: <strong>${num(res.found)}</strong> · записани: <strong>${num(res.saved)}</strong></div>
        <div class="hint" style="margin-top:8px">Похарчени за това: ${Number(res.usd || 0).toFixed(3)} $</div>
      </div>`;
  };
  btn.onclick = async () => {
    const n = Math.max(1, Math.min(50, Number($('#pl-n')?.value || 10)));
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Работя…';
    out.innerHTML = `<div class="hint"><span class="spinner"></span> Питам Google Maps… 30–90 секунди, не затваряй панела.</div>`;
    try {
      const r = await api('/places/enrich', { method: 'POST', body: { limit: n } });
      if (!r.started) {
        out.innerHTML = `<div class="hint warn">${esc(r.reason || 'Не успях да пусна.')}</div>`;
        return;
      }
      let last = null;
      for (let i = 0; i < 40; i += 1) {
        await new Promise((done) => setTimeout(done, 4000));
        try {
          const s = await api('/places/last');
          last = s.run || null;
        } catch {
          /* още не е готово */
        }
        if (last) {
          post(last);
          if (!last.running) break;
        }
      }
      if (!last) out.innerHTML = `<div class="hint warn">Върви по-дълго от очакваното — отвори панела пак след минута.</div>`;
      else toast(`Обогатени ${num(last.saved)} обекта`, last.ok ? 'ok' : 'warn');
    } catch (e) {
      out.innerHTML = `<div class="hint warn">${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };
}

function scraperAdsHtml(info) {
  const sources = info.sources || [];
  const imported = info.imported || [];
  const apify = info.apify || {};
  const badge = (key) => {
    const row = imported.find((x) => x.source === key);
    return row
      ? `${num(row.n)} внесени · последно ${row.last ? ago(row.last) : '—'}`
      : 'още нищо внесено оттук';
  };
  const budget =
    apify.today !== undefined
      ? `${Number(apify.today).toFixed(2)} / ${Number(apify.limit || 0).toFixed(2)} $`
      : '—';

  return `
    <div class="card">
      <div class="card-title">🏷️ Обяви през Apify <span class="pill pill-dim">${num(sources.length)} източника</span></div>
      <div class="hint" style="margin:6px 0 12px">Истинският пазар на обяви в България. Внася се веднага, под профила „SmartPrice Редакция“ — с цена, град, снимка и данни за продавача. Телефони и имейли се махат автоматично.</div>
      ${
        sources.length
          ? sources
              .map(
                (s) => `
        <div style="border:1px solid var(--line); border-radius:12px; padding:12px; margin-bottom:10px">
          <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap">
            <div style="min-width:220px">
              <strong>${esc(s.label)}</strong>
              <span class="pill pill-dim">${esc(s.input === 'url' ? 'адрес на категория' : 'дума за търсене')}</span>
              <div class="hint" style="margin-top:4px">${esc(s.note || '')}</div>
              <div class="hint" style="margin-top:2px">${badge(s.key)}</div>
            </div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
              <input id="ads-q-${esc(s.key)}" placeholder="${esc(
                  s.input === 'url' ? 'https://www.alo.bg/obiavi/avtomobili/' : 'напр. климатик'
                )}" style="min-width:220px">
              <input id="ads-n-${esc(s.key)}" type="number" value="20" min="1" max="200" style="width:84px">
              <button class="btn" data-ads-run="${esc(s.key)}">▶ Пусни</button>
            </div>
          </div>
        </div>`
              )
              .join('')
          : `<div class="hint">Endpoint-ът още не е качен на сървъра.</div>`
      }
      <div class="hint">☁️ Apify днес: ${budget}${
    apify.allowed === false ? ' · <strong>лимитът е стигнат</strong>' : ''
  } <br>Едно пускане отнема 30–120 секунди и харчи стотинки.</div>
      <div id="ads-out" style="margin-top:12px"></div>
    </div>`;
}

/** Бутоните „▶ Пусни“ в таб „Обяви“. */
function bindScraperAds() {
  document.querySelectorAll('[data-ads-run]').forEach((b) => {
    b.onclick = async () => {
      const key = b.dataset.adsRun;
      const q = ($(`#ads-q-${key}`)?.value || '').trim();
      const n = Number($(`#ads-n-${key}`)?.value || 20);
      const out = $('#ads-out');
      if (q.length < 2) {
        out.innerHTML = `<div class="hint warn">Напиши дума за търсене (или адрес на категория в alo.bg).</div>`;
        return;
      }
      const label = b.textContent;
      b.disabled = true;
      b.textContent = '⏳ Работя…';
      const post = (res) => {
        out.innerHTML = `
          <div class="card" style="border-color:${res.ok ? 'rgba(34,197,94,.45)' : 'rgba(245,158,11,.45)'}">
            <div class="card-title">${res.running ? '⏳' : res.ok ? '✅' : '⚠️'} ${esc(res.label || key)}
              ${res.query ? `<span class="pill pill-dim">${esc(res.query)}</span>` : ''}</div>
            <div class="hint" style="margin-top:4px">${esc(res.note || '')}</div>
            <div style="margin-top:10px">Намерени: <strong>${num(res.found)}</strong> ·
              внесени: <strong>${num(res.imported)}</strong> · прескочени: ${num(res.skipped)}</div>
            ${
              (res.skippedReasons || []).length
                ? `<div class="hint" style="margin-top:8px">${res.skippedReasons
                    .map((x) => esc(x))
                    .join('<br>')}</div>`
                : ''
            }
            <div class="hint" style="margin-top:8px">Похарчени за това: ${Number(res.usd || 0).toFixed(3)} $</div>
          </div>`;
      };
      out.innerHTML = `<div class="hint"><span class="spinner"></span> Питам ${esc(
        key.toUpperCase()
      )}… отнема 30–150 секунди, не затваряй панела.</div>`;
      try {
        const r = await api('/classifieds/scan', {
          method: 'POST',
          body: { source: key, query: q, maxItems: Math.max(1, Math.min(200, n || 20)) },
        });
        if (!r.started) {
          out.innerHTML = `<div class="hint warn">${esc(r.reason || 'Не успях да пусна обиколката.')}</div>`;
          return;
        }
        // Обиколката върви ФОНОВО (Cloudflare реже дългите заявки) — питаме докато свърши.
        let last = null;
        for (let i = 0; i < 45; i += 1) {
          await new Promise((done) => setTimeout(done, 4000));
          try {
            const s = await api('/classifieds/last');
            last = s.run || null;
          } catch {
            /* още не е готово — питаме пак */
          }
          if (last) {
            post(last);
            if (!last.running) break;
          }
        }
        const res = last || {};
        if (!last) {
          out.innerHTML = `<div class="hint warn">Обиколката върви по-дълго от очакваното — отвори панела пак след минута.</div>`;
          return;
        }
        out.innerHTML = `
          <div class="card" style="border-color:${res.ok ? 'rgba(34,197,94,.45)' : 'rgba(245,158,11,.45)'}">
            <div class="card-title">${res.ok ? '✅' : '⚠️'} ${esc(res.label || key)}</div>
            <div class="hint" style="margin-top:4px">${esc(res.note || '')}</div>
            <div style="margin-top:10px">Намерени: <strong>${num(res.found)}</strong> ·
              внесени: <strong>${num(res.imported)}</strong> · прескочени: ${num(res.skipped)}</div>
            ${
              (res.skippedReasons || []).length
                ? `<div class="hint" style="margin-top:8px">${res.skippedReasons
                    .map((x) => esc(x))
                    .join('<br>')}</div>`
                : ''
            }
            <div class="hint" style="margin-top:8px">Похарчени за това: ${Number(res.usd || 0).toFixed(3)} $</div>
          </div>`;
        toast(res.ok ? `Внесени ${res.imported} обяви` : 'Не успях — виж подробностите', res.ok ? 'ok' : 'warn');
      } catch (e) {
        out.innerHTML = `<div class="hint warn">${esc(e.message)}</div>`;
      } finally {
        b.disabled = false;
        b.textContent = label;
      }
    };
  });
}

function scraperProgressHtml(cursors, cats) {
  const cursorCard = `
    <div class="card">
      <div class="card-title">\ud83e\udded \u0414\u043e\u043a\u044a\u0434\u0435 \u0441\u043c\u0435 \u0441\u0442\u0438\u0433\u043d\u0430\u043b\u0438 <span class="pill pill-dim">${num(cursors.length)}</span></div>
      <div class="hint" style="margin:6px 0 10px">\u0412\u0441\u0435\u043a\u0438 \u043c\u0430\u0433\u0430\u0437\u0438\u043d \u0441\u0435 \u043f\u043e\u043c\u043d\u0438 \u0434\u043e\u043a\u044a\u0434\u0435 \u0435 \u043e\u0431\u0445\u043e\u0434\u0435\u043d \u2014 \u0441\u043b\u0435\u0434\u0432\u0430\u0449\u0438\u044f\u0442 \u043f\u044a\u0442 \u043f\u0440\u043e\u0434\u044a\u043b\u0436\u0430\u0432\u0430 \u043e\u0442\u0442\u0430\u043c.</div>
      ${
        cursors.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>\u0414\u043e\u043c\u0435\u0439\u043d</th><th>\u041f\u043e\u0437\u0438\u0446\u0438\u044f \u0432 \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0430</th><th>\u041e\u0431\u0438\u043a\u043e\u043b\u043a\u0438</th><th>\u0412\u0437\u0435\u043b \u043d\u0430\u0432\u0435\u0434\u043d\u044a\u0436</th><th>\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u043e</th></tr></thead>
              <tbody>${cursors
                .map(
                  (c) => `<tr>
                <td><strong>${esc(c.domain)}</strong></td>
                <td>#${num(c.cursor_offset)}</td>
                <td>${num(c.runs)}</td>
                <td>${num(c.last_span)}</td>
                <td>${c.updated_at ? ago(c.updated_at) : '\u2014'}</td>
              </tr>`
                )
                .join('')}</tbody></table></div>`
          : `<div class="hint">\u041e\u0449\u0435 \u043d\u044f\u043c\u0430 \u043e\u0431\u0445\u043e\u0434\u0435\u043d \u043c\u0430\u0433\u0430\u0437\u0438\u043d \u0441 \u043a\u0443\u0440\u0441\u043e\u0440. \u041f\u0443\u0441\u043d\u0438 \u043e\u0431\u0438\u043a\u043e\u043b\u043a\u0430 \u0438 \u0442\u0443\u043a \u0449\u0435 \u0432\u0438\u0434\u0438\u0448 \u0434\u043e\u043a\u044a\u0434\u0435 \u0435 \u0441\u0442\u0438\u0433\u043d\u0430\u043b\u0430.</div>`
      }
    </div>`;

  const catCard = `
    <div class="card" style="margin-top:14px">
      <div class="card-title">\ud83c\udff7\ufe0f \u041d\u0430\u0443\u0447\u0435\u043d\u0438 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0438 <span class="pill pill-dim">${num(cats.length)}</span></div>
      <div class="hint" style="margin:6px 0 10px">\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f\u0442\u0430 \u043d\u0430 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u0430 \u0441\u0435 \u0440\u0430\u0437\u043f\u043e\u0437\u043d\u0430\u0432\u0430 \u0432\u0435\u0434\u043d\u044a\u0436 \u0438 \u0441\u0435 \u043f\u043e\u043c\u043d\u0438. \u041c\u0430\u0445\u043d\u0435\u0448 \u043b\u0438 \u0440\u0435\u0434, \u0449\u0435 \u0441\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438 \u043d\u0430\u043d\u043e\u0432\u043e.</div>
      ${
        cats.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f \u0432 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u0430</th><th>\u041d\u0430\u0448\u0430 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f</th><th>\u041f\u043e\u043b\u0437\u0432\u0430\u043d\u0430</th><th></th></tr></thead>
              <tbody>${cats
                .map(
                  (c) => `<tr>
                <td>${esc(c.source)}</td>
                <td><strong>${esc(c.category)}</strong></td>
                <td>${num(c.hits)}\u00d7</td>
                <td class="actions"><button class="btn btn-sm btn-danger" data-sc-cat-del="${esc(c.source)}">\u2715 \u041c\u0430\u0445\u043d\u0438</button></td>
              </tr>`
                )
                .join('')}</tbody></table></div>`
          : `<div class="hint">\u041e\u0449\u0435 \u043d\u044f\u043c\u0430 \u043d\u0430\u0443\u0447\u0435\u043d\u0438 \u0441\u044a\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u044f.</div>`
      }
    </div>`;

  return cursorCard + catCard;
}

/** \u0411\u0443\u0442\u043e\u043d\u0438\u0442\u0435 \u0432 \u0442\u0430\u0431 \u201e\u041d\u0430\u043f\u0440\u0435\u0434\u044a\u043a\u201c (\u043c\u0430\u0445\u043d\u0438 \u0441\u044a\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0435). */
function bindScraperProgress() {
  document.querySelectorAll('[data-sc-cat-del]').forEach((b) => {
    b.onclick = () => {
      const source = b.dataset.scCatDel;
      confirmAction({
        title: '\u0414\u0430 \u043c\u0430\u0445\u043d\u0430 \u043b\u0438 \u0441\u044a\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0435\u0442\u043e?',
        message: `\u201e${source}\u201c \u0432\u0435\u0447\u0435 \u043d\u044f\u043c\u0430 \u0434\u0430 \u0441\u043e\u0447\u0438 \u043a\u044a\u043c \u0442\u0430\u0437\u0438 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f \u2014 \u043f\u0440\u0438 \u0441\u043b\u0435\u0434\u0432\u0430\u0449\u043e\u0442\u043e \u0441\u043a\u0430\u043d\u0438\u0440\u0430\u043d\u0435 \u0449\u0435 \u0441\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438 \u043d\u0430\u043d\u043e\u0432\u043e.`,
        confirmLabel: '\u041c\u0430\u0445\u043d\u0438',
        onConfirm: async () => {
          try {
            await api(`/scraper/categories/${encodeURIComponent(source)}`, { method: 'DELETE' });
            const row = b.closest('tr');
            if (row) row.remove();
            toast('\u0421\u044a\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0435\u0442\u043e \u0435 \u043c\u0430\u0445\u043d\u0430\u0442\u043e');
          } catch (e) {
            toast(e.message, 'warn');
          }
        },
      });
    };
  });
}

function bindScraperSites() {
  document.querySelectorAll('[data-sc-site]').forEach((b) => {
    b.onclick = async () => {
      const domain = b.dataset.scSite;
      const all = await api('/scraper/sites');
      const site = (all.items || []).find((s) => s.domain === domain) || {};
      const sel = site.selectors || {};
      openModal(
        `Селектори за ${domain}`,
        `<div class="hint" style="margin-bottom:10px">Ползват се само ако автоматичните стратегии не стигнат. Формат: <code>title: h1</code>, <code>price: .price@text</code>, <code>image: img@src</code>, <code>list: a.product@href</code>.</div>
         <label class="field full"><span>Селектори (по един на ред)</span>
           <textarea id="sc-site-sel" rows="6">${esc(Object.entries(sel).map(([k, v]) => `${k}: ${v}`).join('\n'))}</textarea></label>
         <label class="field full"><span>Бележки</span>
           <textarea id="sc-site-notes" rows="3">${esc(site.notes || '')}</textarea></label>`,
        [
          {
            id: 'sc-site-save',
            label: 'Запази',
            cls: 'btn-primary',
            onClick: async () => {
              const selectors = {};
              ($('#sc-site-sel').value || '').split('\n').forEach((line) => {
                const i = line.indexOf(':');
                if (i > 0) selectors[line.slice(0, i).trim()] = line.slice(i + 1).trim();
              });
              try {
                await api(`/scraper/sites/${encodeURIComponent(domain)}`, {
                  method: 'PATCH',
                  body: { selectors, notes: $('#sc-site-notes').value.trim() },
                });
                toast('Селекторите са записани');
                closeModal();
                render('scraper', true);
              } catch (e) {
                toast(e.message, 'error');
              }
            },
          },
          { id: 'sc-site-cancel', label: 'Отказ', cls: 'btn-ghost', onClick: closeModal },
        ],
        true
      );
    };
  });

  document.querySelectorAll('[data-sc-site-del]').forEach((b) => {
    b.onclick = () =>
      confirmAction({
        title: 'Изтриване на наученото',
        message: `Да изтрия ли наученото за „${esc(b.dataset.scSiteDel)}“?`,
        details: ['Следващият път системата ще проучва сайта отначало.'],
        confirmLabel: 'Изтрий',
        onConfirm: async () => {
          await api(`/scraper/sites/${encodeURIComponent(b.dataset.scSiteDel)}`, { method: 'DELETE' });
          toast('Изтрито');
          closeModal();
          render('scraper', true);
        },
      });
  });
}

/** Зарежда задачата и рисува прогреса + таблицата с продукти. */
async function scraperLoadJob() {
  const id = scraperJobId;
  const data = await api(`/scraper/jobs/${id}`);
  const job = data.job;
  const items = data.items || [];
  const counts = data.counts || {};
  const bar = $('#sc-job');
  if (!bar) return;

  const active = ['queued', 'discovering', 'parsing', 'enriching', 'importing'].includes(job.status);
  const total = Math.max(1, job.target_count || 1);
  const donePct = Math.min(100, Math.round(((Number(job.parsed) || 0) / total) * 100));

  bar.innerHTML = `
    <div class="card" style="border-color:${active ? 'rgba(6,182,212,.55)' : job.status === 'failed' ? 'rgba(244,63,94,.5)' : 'rgba(34,197,94,.5)'}">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span>${active ? '<span class="spinner"></span>' : job.status === 'done' ? '✅' : '⚠️'} Обиколка на ${esc(job.domain)}
          <span class="pill pill-dim">${esc(SCRAPE_STATUS_LABELS[job.status] || job.status)}</span>
          ${job.strategy ? `<span class="pill pill-dim">стратегия: ${esc(job.strategy)}</span>` : ''}
          <span class="pill pill-dim">${job.mode === 'import' ? 'директен запис' : 'преглед преди внасяне'}</span></span>
        <span style="display:flex;gap:8px">
          ${active ? '<button class="btn btn-sm btn-danger" id="sc-cancel">⏹ Спри</button>' : `<button class="btn btn-sm btn-ghost" id="sc-retry">↻ Пусни пак</button>`}
          <button class="btn btn-sm btn-ghost" id="sc-refresh">↻ Обнови</button>
        </span>
      </div>

      <div class="bar-track" style="margin:10px 0 6px"><div class="bar-fill" id="sc-fill" style="width:${donePct}%"></div></div>
      <div class="hint" id="sc-counts">
        Открити: <strong>${num(job.discovered)}</strong> · Прочетени: <strong>${num(job.parsed)}</strong> ·
        Внесени: <strong>${num(job.imported)}</strong> · Пропуснати: <strong>${num(job.skipped)}</strong> ·
        Грешки: <strong>${num(job.failed)}</strong> · Чакат преглед: <strong>${num(counts.parsed || 0)}</strong>
        ${job.error ? `<br><span style="color:#FB7185">${esc(job.error)}</span>` : ''}
      </div>
      <details style="margin-top:8px"${active ? ' open' : ''}>
        <summary style="cursor:pointer;color:var(--muted);font-size:13px;padding:4px 0">Дневник на обиколката</summary>
        <pre id="sc-log" style="max-height:190px;overflow:auto;background:rgba(148,163,184,.08);border-radius:10px;padding:10px;font-size:12px;line-height:1.6;margin:6px 0 0">${esc((job.log || []).join('\n'))}</pre>
      </details>

      ${
        counts.parsed > 0
          ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center">
               <button class="btn btn-ok" id="sc-import">⬇ Внеси избраните (<span id="sc-sel-count">${scraperSelected.size}</span>)</button>
               <button class="btn btn-primary" id="sc-import-all">Внеси всички (${num(counts.parsed)})</button>
               <button class="btn btn-ghost" id="sc-discard">✕ Отхвърли избраните</button>
               <button class="btn btn-ghost" id="sc-selall">Избери всички</button>
               <button class="btn btn-ghost" id="sc-selnone">Изчисти избора</button>
             </div>`
          : ''
      }
    </div>

    ${
      items.length
        ? `<div class="card" style="margin-top:12px">
             <div class="card-title">📦 Какво е извадено <span class="pill pill-dim">${num(items.length)}</span></div>
             <div class="hint" style="margin:6px 0 10px">Това е истината от сайта — заглавие, цена, снимка, категория и описание. Нищо не влиза в приложението, докато не го одобриш.</div>
             <div class="table-wrap" style="max-height:560px;overflow:auto">
               <table>
                 <thead><tr><th style="width:34px"></th><th style="width:72px">Снимка</th><th>Продукт</th><th>Цена</th><th>Категория</th><th>Състояние</th></tr></thead>
                 <tbody>
                   ${items
                     .map(
                       (it) => `<tr>
                     <td>${it.status === 'parsed' ? `<input type="checkbox" data-sc-item="${esc(it.id)}"${scraperSelected.has(String(it.id)) ? ' checked' : ''}>` : ''}</td>
                     <td>${it.local_image_url || it.image_url ? `<img src="${esc(it.local_image_url || it.image_url)}" loading="lazy" style="width:60px;height:60px;object-fit:cover;border-radius:8px">` : '<span class="hint">—</span>'}</td>
                     <td>
                       <div style="font-weight:700">${esc(it.title || '(без заглавие)')}</div>
                       <div class="hint" style="margin:2px 0 0">${esc(String(it.description || '').slice(0, 190))}</div>
                       <div class="hint" style="margin:2px 0 0"><a href="${esc(it.source_url)}" target="_blank" rel="noopener">източник ↗</a>${it.breadcrumb ? ' · ' + esc(it.breadcrumb) : ''}</div>
                     </td>
                     <td><strong>${it.price ? money(it.price) : '—'}</strong>${it.reference_price ? `<div class="hint" style="margin:0">за сравнение: ${money(it.reference_price)}</div>` : ''}</td>
                     <td>${esc(SCRAPE_CAT_LABELS[it.category] || it.category || '—')}${it.polarity ? ` ${it.polarity === 'green' ? '🟢' : '🔴'}` : ''}</td>
                     <td>${
                       it.status === 'imported'
                         ? `<span class="pill" style="background:rgba(34,197,94,.16);color:#34D399">внесен</span>`
                         : it.status === 'skipped'
                           ? `<span class="pill pill-dim">пропуснат</span><div class="hint" style="margin:2px 0 0">${esc(it.reason || '')}</div>`
                           : it.status === 'failed'
                             ? `<span class="pill" style="background:rgba(244,63,94,.16);color:#FB7185">грешка</span><div class="hint" style="margin:2px 0 0">${esc(it.reason || '')}</div>`
                             : '<span class="pill pill-dim">чака преглед</span>'
                     }</td>
                   </tr>`
                     )
                     .join('')}
                 </tbody>
               </table>
             </div>
           </div>`
        : ''
    }`;

  /* ------------------------------------------------------- събития */

  $('#sc-refresh')?.addEventListener('click', () => scraperLoadJob());
  $('#sc-cancel')?.addEventListener('click', () =>
    confirmAction({
      title: 'Спиране на обиколката',
      message: 'Да спра ли задачата? Вече внесеното остава.',
      confirmLabel: 'Спри',
      onConfirm: async () => {
        await api(`/scraper/jobs/${job.id}/cancel`, { method: 'POST' });
        toast('Спряно');
        closeModal();
        await scraperLoadJob();
      },
    })
  );
  $('#sc-retry')?.addEventListener('click', async () => {
    await api(`/scraper/jobs/${job.id}/retry`, { method: 'POST' });
    toast('Пусната отново');
    await scraperLoadJob();
  });

  document.querySelectorAll('[data-sc-item]').forEach((cb) => {
    cb.onchange = () => {
      const id = String(cb.dataset.scItem);
      if (cb.checked) scraperSelected.add(id);
      else scraperSelected.delete(id);
      const el = $('#sc-sel-count');
      if (el) el.textContent = String(scraperSelected.size);
    };
  });

  $('#sc-selall')?.addEventListener('click', () => {
    document.querySelectorAll('[data-sc-item]').forEach((cb) => {
      cb.checked = true;
      scraperSelected.add(String(cb.dataset.scItem));
    });
    const el = $('#sc-sel-count');
    if (el) el.textContent = String(scraperSelected.size);
  });
  $('#sc-selnone')?.addEventListener('click', () => {
    scraperSelected = new Set();
    document.querySelectorAll('[data-sc-item]').forEach((cb) => {
      cb.checked = false;
    });
    const el = $('#sc-sel-count');
    if (el) el.textContent = '0';
  });

  $('#sc-import')?.addEventListener('click', async () => {
    if (scraperSelected.size === 0) return toast('Избери продукти с чекчетата', 'warn');
    const btn = $('#sc-import');
    btn.disabled = true;
    btn.textContent = 'Внасям…';
    try {
      const res = await api(`/scraper/jobs/${job.id}/import`, {
        method: 'POST',
        body: { ids: [...scraperSelected].map(Number) },
      });
      toast(`Внесени: ${res.imported}${res.skipped ? `, пропуснати: ${res.skipped}` : ''}`);
      if (res.failed?.length) toast(`Не минаха: ${res.failed.length}`, 'warn');
      scraperSelected = new Set();
      await scraperLoadJob();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = '⬇ Внеси избраните';
    }
  });

  $('#sc-import-all')?.addEventListener('click', () =>
    confirmAction({
      title: 'Внасяне на всичко',
      message: `Да внеса ли всичките ${num(counts.parsed)} продукта от прегледа?`,
      details: ['Влизат под профила „SmartPrice Редакция“ с етикет „ОТ МАГАЗИН“.', 'Снимките се свалят при нас.'],
      confirmLabel: 'Внеси всички',
      danger: false,
      onConfirm: async () => {
        const res = await api(`/scraper/jobs/${job.id}/import`, { method: 'POST', body: { all: true } });
        toast(`Внесени: ${res.imported}${res.skipped ? `, пропуснати: ${res.skipped}` : ''}`);
        closeModal();
        await scraperLoadJob();
      },
    })
  );

  $('#sc-discard')?.addEventListener('click', async () => {
    if (scraperSelected.size === 0) return toast('Избери какво да отхвърля', 'warn');
    await api(`/scraper/jobs/${job.id}/discard`, {
      method: 'POST',
      body: { ids: [...scraperSelected].map(Number) },
    });
    toast('Отхвърлени');
    scraperSelected = new Set();
    await scraperLoadJob();
  });

  /* --------------------------------------------------- следене на прогреса */
  if (active) {
    scraperStopPoll();
    scraperPoll = setInterval(async () => {
      if (state.page !== 'scraper') return scraperStopPoll();
      try {
        const fresh = await api(`/scraper/jobs/${id}`);
        const j = fresh.job;
        const c = fresh.counts || {};
        const fill = $('#sc-fill');
        if (fill) fill.style.width = `${Math.min(100, Math.round(((Number(j.parsed) || 0) / Math.max(1, j.target_count || 1)) * 100))}%`;
        const countsEl = $('#sc-counts');
        if (countsEl) {
          countsEl.innerHTML = `Открити: <strong>${num(j.discovered)}</strong> · Прочетени: <strong>${num(j.parsed)}</strong> ·
            Внесени: <strong>${num(j.imported)}</strong> · Пропуснати: <strong>${num(j.skipped)}</strong> ·
            Грешки: <strong>${num(j.failed)}</strong> · Чакат преглед: <strong>${num(c.parsed || 0)}</strong>
            ${j.error ? `<br><span style="color:#FB7185">${esc(j.error)}</span>` : ''}`;
        }
        const logEl = $('#sc-log');
        if (logEl) {
          const wasBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 24;
          logEl.textContent = (j.log || []).join('\n');
          if (wasBottom) logEl.scrollTop = logEl.scrollHeight;
        }
        if (!['queued', 'discovering', 'parsing', 'enriching', 'importing'].includes(j.status)) {
          scraperStopPoll();
          await scraperLoadJob();
        }
      } catch {
        scraperStopPoll();
      }
    }, 2500);
  }
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

/* ---------------------------------------------------------- бизнеси */

/**
 * 🏢 „Търговец в SmartPrice“ — проверката на търговци.
 *
 * Защо е човешко решение: ЕИК може да съвпадне с касова бележка (тогава
 * системата одобрява сама и тук има зелена отметка „автоматично“), но всичко
 * останало трябва да мине през очи. Един обект може да има само един проверен
 * търговец — затова одобрението казва изрично, ако вече има друг.
 */
const BIZ_STATUS = {
  pending: ['⏳ Чака проверка', 'pill-gold'],
  verified: ['✅ Проверен', 'pill-green'],
  rejected: ['❌ Отхвърлен', 'pill-red'],
};

async function renderBusinesses(box, force = false) {
  const status = (cache.bizStatus = force ? cache.bizStatus || 'pending' : cache.bizStatus || 'pending');
  const q = cache.bizQuery || '';
  const data = await api(
    `/businesses?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&limit=100`
  );
  const items = data.items || [];
  const s = data.summary || {};

  box.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:14px">
      <div class="card kpi"><div class="kpi-label">Всички заявки</div><div class="kpi-value">${num(s.total)}</div></div>
      <div class="card kpi"><div class="kpi-label">Чакат проверка</div><div class="kpi-value gold">${num(s.pending)}</div></div>
      <div class="card kpi"><div class="kpi-label">Проверени търговци</div><div class="kpi-value green">${num(s.verified)}</div></div>
      <div class="card kpi"><div class="kpi-label">С платен абонамент</div><div class="kpi-value cyan">${num(s.paid)}</div></div>
    </div>

    <div class="toolbar">
      <select class="grow" id="biz-status">
        ${[
          ['pending', '⏳ Чакащи проверка'],
          ['verified', '✅ Проверени'],
          ['rejected', '❌ Отхвърлени'],
          ['all', 'Всички заявки'],
        ]
          .map(([v, label]) => `<option value="${v}"${v === status ? ' selected' : ''}>${label}</option>`)
          .join('')}
      </select>
      <input class="grow" id="biz-q" placeholder="Търси по обект, фирма, ЕИК или имейл…" value="${esc(q)}" />
      <button class="btn" id="biz-search">Търси</button>
    </div>

    <div class="card">
      <div class="card-title">🏢 Заявки „това е моят обект“ (${num(items.length)})</div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Обект</th><th>Фирма / ЕИК</th><th>Собственик</th><th>Статус</th><th>План</th><th></th>
        </tr></thead>
        <tbody>
        ${
          items.length
            ? items
                .map((b) => {
                  const st = BIZ_STATUS[b.status] || ['?', 'pill-dim'];
                  const paid = b.paid_until && new Date(b.paid_until).getTime() > Date.now();
                  return `<tr>
              <td>${esc(b.place_name)}<div class="dim">${esc(b.city || '—')} · ${num(b.signals_count)} сигнала</div></td>
              <td>${esc(b.legal_name)}<div class="dim">ЕИК: ${esc(b.tax_id || '—')}</div>
                  ${b.proof_url ? `<div><a class="dim" href="${esc(b.proof_url)}" target="_blank">📎 доказателство</a></div>` : ''}</td>
              <td>${esc(b.owner_name || '—')}<div class="dim">${esc(b.owner_email || '')}</div>
                  <div class="dim">${esc(b.contact_email)}${b.contact_phone ? ' · ' + esc(b.contact_phone) : ''}</div></td>
              <td><span class="pill ${st[1]}">${st[0]}</span>
                  ${b.auto_approved ? '<div class="dim">одобрено автоматично по ЕИК</div>' : ''}
                  ${b.reject_reason ? `<div class="dim">${esc(b.reject_reason)}</div>` : ''}
                  <div class="dim">${num(b.replies_count)} официални отговора</div>
                  <div class="dim">${num(b.offers_count)} оферти (${num(b.offers_live)} активни)</div></td>
              <td>${paid ? `<span class="pill pill-green">💰 до ${dt(b.paid_until)}</span>` : '<span class="pill pill-dim">без абонамент</span>'}</td>
              <td style="white-space:nowrap">
                ${b.status !== 'verified' ? `<button class="btn btn-sm" data-b-approve="${b.id}">✅ Одобри</button>` : ''}
                ${b.status !== 'rejected' ? `<button class="btn btn-sm btn-danger" data-b-reject="${b.id}">✕ Отхвърли</button>` : ''}
                <button class="btn btn-sm" data-b-plan="${b.id}">💰 План</button>
                <button class="btn btn-sm" data-b-replies="${b.id}">💬 Отговори</button>
                <button class="btn btn-sm btn-danger" data-b-del="${b.id}" title="Маха заявката напълно">🗑</button>
              </td>
            </tr>`;
                })
                .join('')
            : '<tr><td colspan="6" class="empty">Няма заявки с този филтър</td></tr>'
        }
        </tbody></table></div>
      <div class="hint" style="margin-top:10px">
        Провереният търговец получава значка „✅ Проверен търговец“ на страницата на обекта и
        право на ЕДИН официален отговор под всеки сигнал за своя обект. Един обект може да има
        само един проверен търговец. Абонаментът засега се води ръчно оттук (бутон „💰 План“) —
        плащането през Stripe идва във Фаза 2.
      </div>
    </div>`;

  const sel = $('#biz-status');
  sel.onchange = (e) => {
    cache.bizStatus = e.target.value;
    render('businesses', false);
  };
  const doSearch = () => {
    cache.bizQuery = $('#biz-q').value.trim();
    render('businesses', false);
  };
  $('#biz-search').onclick = doSearch;
  $('#biz-q').onkeydown = (e) => {
    if (e.key === 'Enter') doSearch();
  };

  box.querySelectorAll('[data-b-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Да одобря този търговец? Обектът ще получи значка „Проверен търговец“.')) return;
      try {
        const res = await api(`/businesses/${btn.dataset.bApprove}/approve`, { method: 'POST' });
        toast(res.message || 'Одобрен');
      } catch (e) {
        toast(e.message, 'error');
      }
      render('businesses', true);
    });
  });

  box.querySelectorAll('[data-b-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const reason = prompt('Причина за отхвърлянето (ще я види търговецът):', '');
      if (reason === null) return;
      if (!reason.trim()) {
        toast('Нужна е причина', 'error');
        return;
      }
      try {
        await api(`/businesses/${btn.dataset.bReject}/reject`, {
          method: 'POST',
          body: { reason: reason.trim() },
        });
        toast('Отхвърлено');
      } catch (e) {
        toast(e.message, 'error');
      }
      render('businesses', true);
    });
  });

  box.querySelectorAll('[data-b-plan]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const monthsRaw = prompt(
        'За колко месеца да е платен абонаментът?\n(0 = без абонамент / спиране)',
        '1'
      );
      if (monthsRaw === null) return;
      const months = Math.max(0, Math.min(60, Number(monthsRaw) || 0));
      try {
        await api(`/businesses/${btn.dataset.bPlan}/plan`, {
          method: 'POST',
          body: { tier: months > 0 ? 'verified' : 'free', months },
        });
        toast(months > 0 ? `Платен абонамент за ${months} мес.` : 'Абонаментът е спрян');
      } catch (e) {
        toast(e.message, 'error');
      }
      render('businesses', true);
    });
  });

  box.querySelectorAll('[data-b-replies]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const res = await api(`/businesses/${btn.dataset.bReplies}/replies`);
        const list = res.items || [];
        if (!list.length) {
          alert('Този търговец още не е писал официален отговор.');
          return;
        }
        alert(
          list
            .map(
              (r) =>
                `[${dt(r.created_at)}] ${r.post_title || ''} (${r.place_name}${r.city ? ', ' + r.city : ''})\n${r.body}`
            )
            .join('\n\n———\n\n')
        );
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  });

  box.querySelectorAll('[data-b-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Да махна заявката напълно? Това не може да се върне.')) return;
      try {
        await api(`/businesses/${btn.dataset.bDel}`, { method: 'DELETE' });
        toast('Заявката е изтрита');
      } catch (e) {
        toast(e.message, 'error');
      }
      render('businesses', true);
    });
  });
}

/* ---------------------------------------------------------- известия */

/* ------------------------------------------- 🧭 Обиколки по обекти */

/** Как се показва всеки статус на обиколката. */
const LEAD_STATUS = {
  new: { label: '🆕 нов', cls: 'pill-dim' },
  contacted: { label: '📞 посетен', cls: 'pill-gold' },
  interested: { label: '🤝 интересува се', cls: 'pill-cyan' },
  refused: { label: '❌ отказа', cls: 'pill-red' },
  joined: { label: '🎉 включен', cls: 'pill-green' },
};

/**
 * Готовият текст за разговор/съобщение.
 *
 * Защо е в панела, а не наизуст: човекът отива на място и трябва да каже точното
 * нещо, без да се сеща. Името на обекта се попълва само.
 */
function pitchFor(lead) {
  const where = lead.city ? ` (${lead.city})` : '';
  return (
    'Здравейте! Пиша ви за SmartPrice — приложението, в което хората качват цени и сигнали за обекти (smartprice.bg).\n\n' +
    `Видях обекта ви — ${lead.name}${where}. Исках да ви предложа нещо, което е безплатно за начало:\n\n` +
    '✅ значка „Проверен търговец“ — хората виждат, че сте коректен\n' +
    '💬 право на официален отговор под всеки сигнал — да чуят и вашата страна\n' +
    '🏷️ възможност да пускате оферти в обекта си\n' +
    '📊 статистика колко души гледат обекта ви\n\n' +
    'Първият официален отговор на месец е безплатен, пълният план е 19 €/мес.\n' +
    'Заявката е 3 минути, с ЕИК: smartprice.bg/business/register\n\n' +
    'Кажете „да“ и ще ви покажа с 2-3 снимки как става.'
  );
}

/**
 * 🧭 Обиколки — работният списък за терен.
 *
 * Показва кои обекти около даден град ГИ НЯМА в приложението, с телефон и адрес,
 * за да се отиде при тях, и пази статуса на посещението. Обектите се намират през
 * Google Maps (Apify) — това харчи пари, затова оценката се показва преди пускане.
 */
async function renderObykolki(box, force = false) {
  const f = cache.leadFilters || (cache.leadFilters = { status: 'all', city: '', q: '', onlyNotInApp: true, onlyWithPhone: false });
  const params = new URLSearchParams({ status: f.status, limit: '300' });
  if (f.city) params.set('city', f.city);
  if (f.q) params.set('q', f.q);
  if (f.onlyNotInApp) params.set('onlyNotInApp', 'true');
  if (f.onlyWithPhone) params.set('onlyWithPhone', 'true');

  const d = await api('/leads?' + params.toString());
  const runs = await api('/leads/runs');
  const s = d.stats;
  const b = d.budget || {};
  const running = (runs.runs || []).find((r) => r.status === 'running');

  box.innerHTML = `
    <div class="grid grid-5" style="margin-bottom:14px">
      <div class="card kpi"><div class="kpi-label">Обекти в списъка</div><div class="kpi-value">${num(s.total)}</div></div>
      <div class="card kpi"><div class="kpi-label">Непосетени</div><div class="kpi-value cyan">${num(s.byStatus.new)}</div></div>
      <div class="card kpi"><div class="kpi-label">Интересуват се</div><div class="kpi-value gold">${num(s.byStatus.interested)}</div></div>
      <div class="card kpi"><div class="kpi-label">Станали търговци</div><div class="kpi-value green">${num(s.byStatus.joined)}</div></div>
      <div class="card kpi"><div class="kpi-label">С телефон</div><div class="kpi-value">${num(s.withPhone)}</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title">🔎 Намери нови обекти в Google Maps</div>
      <div class="toolbar" style="margin-bottom:10px">
        <input id="ld-city" placeholder="Град (напр. Пловдив)" maxlength="60" style="width:170px" />
        <input id="ld-term" placeholder="Какво търсим (аптека, кафене, сервиз…)" maxlength="60" style="width:250px" />
        <select id="ld-limit">
          <option value="10">10 обекта</option>
          <option value="20">20 обекта</option>
          <option value="30" selected>30 обекта</option>
          <option value="60">60 обекта</option>
        </select>
        <button class="btn btn-primary" id="ld-search">Търси</button>
      </div>
      <div class="hint">
        Търсенето върви <strong>във фона</strong> (1-3 минути) и <strong>харчи пари</strong> в Apify —
        около <strong>$0.02 на обект</strong> (измерено). Днес похарчени: <strong>$${Number(b.today ?? 0).toFixed(2)}</strong>
        от дневен лимит <strong>$${Number(b.limitUsd ?? 0).toFixed(2)}</strong>.
        ${running ? `<br><span class="pill pill-gold">⏳ тече търсене „${esc(running.term)}“ в ${esc(running.city)} — ще се появи само</span>` : ''}
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title">🗺️ Маршрут за един ден</div>
      <div class="toolbar" style="margin-bottom:10px">
        <input id="lr-city" placeholder="Град (напр. Пловдив)" value="${esc(f.city)}" maxlength="60" style="width:170px" />
        <select id="lr-max">
          <option value="5">5 спирки</option>
          <option value="8" selected>8 спирки</option>
          <option value="10">10 спирки</option>
        </select>
        <button class="btn btn-primary" id="lr-go">Направи маршрут</button>
        <button class="btn" id="lr-copy" style="display:none">📋 Копирай списъка</button>
        <a class="btn" id="lr-maps" style="display:none" target="_blank" rel="noopener">🧭 Отвори в Google Maps</a>
      </div>
      <div id="lr-out" class="hint">Избери град — подреждам обектите по близост, за да не кръжиш напразно. Работи само за обекти с координати (тези от Google Maps ги имат).</div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title">➕ Добави обект на ръка (видян на улицата)</div>
      <div class="toolbar" style="margin-bottom:10px">
        <input id="ldn-name" placeholder="Име на обекта *" maxlength="120" style="width:220px" />
        <input id="ldn-city" placeholder="Град" maxlength="60" style="width:120px" />
        <input id="ldn-addr" placeholder="Адрес" maxlength="200" style="width:200px" />
        <input id="ldn-phone" placeholder="Телефон" maxlength="30" style="width:140px" />
        <input id="ldn-note" placeholder="Бележка" maxlength="400" class="grow" />
        <button class="btn" id="ldn-add">Добави</button>
      </div>
      <div class="hint">Полезно, ако го виждаш на място, но го няма в Google. Обект, който вече е в приложението, се отбелязва сам — няма да ходиш напразно.</div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="toolbar">
        <select id="ld-fstatus">
          <option value="all"${f.status === 'all' ? ' selected' : ''}>Всички статуси</option>
          ${Object.entries(LEAD_STATUS).map(([k, v]) => `<option value="${k}"${f.status === k ? ' selected' : ''}>${v.label}</option>`).join('')}
        </select>
        <input id="ld-fcity" placeholder="Град" value="${esc(f.city)}" maxlength="60" style="width:130px" />
        <input id="ld-fq" placeholder="Търси по име или адрес" value="${esc(f.q)}" class="grow" />
        <label class="hint" style="display:flex;gap:6px;align-items:center">
          <input type="checkbox" id="ld-noapp" ${f.onlyNotInApp ? 'checked' : ''} /> само тези, които ги няма в приложението
        </label>
        <label class="hint" style="display:flex;gap:6px;align-items:center">
          <input type="checkbox" id="ld-phone" ${f.onlyWithPhone ? 'checked' : ''} /> само с телефон
        </label>
        <button class="btn" id="ld-csv">⬇️ CSV за печат</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">🧭 Списък за обиколка (${num(d.items.length)})</div>
      ${
        d.items.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Обект</th><th>Град</th><th>Връзка</th><th>Рейтинг</th><th>Статус</th><th>Бележка</th><th></th></tr></thead>
              <tbody>
                ${d.items
                  .map((l) => {
                    const tel = (l.phone || '').replace(/[^\d+]/g, '');
                    const viber = tel ? `viber://chat?number=${encodeURIComponent(tel.startsWith('+') ? tel : '+' + tel)}` : '';
                    return `<tr>
                      <td>
                        <strong>${esc(l.name)}</strong>
                        ${l.inApp ? '<div><span class="pill pill-green" title="вече има сигнал в приложението">вече в приложението</span></div>' : ''}
                        ${l.address ? `<div class="dim">${esc(l.address)}</div>` : ''}
                      </td>
                      <td>${esc(l.city || '—')}</td>
                      <td>
                        ${l.phone ? `<a href="tel:${esc(tel)}">${esc(l.phone)}</a>` : '<span class="dim">няма телефон</span>'}
                        ${viber ? `<div><a href="${viber}" class="dim">Viber</a></div>` : ''}
                      </td>
                      <td>${l.rating != null ? `${Number(l.rating).toFixed(1)} <span class="dim">(${num(l.reviewsCount || 0)})</span>` : '<span class="dim">—</span>'}</td>
                      <td>
                        <select class="lead-status" data-id="${l.id}">
                          ${Object.entries(LEAD_STATUS).map(([k, v]) => `<option value="${k}"${l.status === k ? ' selected' : ''}>${v.label}</option>`).join('')}
                        </select>
                      </td>
                      <td><input class="lead-note" data-id="${l.id}" value="${esc(l.note)}" placeholder="какво каза" maxlength="400" style="width:170px" /></td>
                      <td style="white-space:nowrap">
                        <button class="btn btn-sm lead-pitch" data-id="${l.id}" title="Готовият текст за разговор">💬 Пича</button>
                        ${l.mapsUrl ? `<a class="btn btn-sm" href="${esc(l.mapsUrl)}" target="_blank" rel="noopener" title="Отвори в Google Maps">🗺️</a>` : ''}
                        <button class="btn btn-sm btn-danger lead-del" data-id="${l.id}" title="Махни от списъка">🗑️</button>
                      </td>
                    </tr>`;
                  })
                  .join('')}
              </tbody></table></div>`
          : '<div class="empty">Още няма обекти. Пусни търсене по град и термин (напр. „аптека“ в Пловдив) или добави обект на ръка.</div>'
      }
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-title">📜 Последни търсения (всяко е харчило пари)</div>
      ${
        (runs.runs || []).length
          ? `<div class="table-wrap"><table><thead><tr><th>Кога</th><th>Търсене</th><th>Намерени</th><th>Записани</th><th>Похарчено</th><th>Състояние</th></tr></thead><tbody>
              ${(runs.runs || [])
                .map(
                  (r) => `<tr>
                    <td>${dt(r.startedAt)}</td>
                    <td>„${esc(r.term)}“ в ${esc(r.city)} <span class="dim">(до ${num(r.limitCount)})</span></td>
                    <td>${num(r.found)}</td>
                    <td>${num(r.added)}</td>
                    <td>${r.realUsd != null ? '$' + Number(r.realUsd).toFixed(3) : r.estUsd != null ? '~$' + Number(r.estUsd).toFixed(3) : '—'}</td>
                    <td><span class="pill ${r.status === 'done' ? 'pill-green' : r.status === 'running' ? 'pill-gold' : 'pill-red'}">${r.status === 'done' ? 'готово' : r.status === 'running' ? 'тече' : 'провал'}</span>
                      ${r.note ? `<div class="dim">${esc(r.note)}</div>` : ''}</td>
                  </tr>`
                )
                .join('')}
            </tbody></table></div>`
          : '<div class="empty">Още нищо не е търсено.</div>'
      }
    </div>
  `;

  const reload = () => renderObykolki(box, true);

  $('#ld-fstatus').onchange = (e) => { f.status = e.target.value; reload(); };
  $('#ld-fcity').onchange = (e) => { f.city = e.target.value.trim(); reload(); };
  $('#ld-fq').onchange = (e) => { f.q = e.target.value.trim(); reload(); };
  $('#ld-noapp').onchange = (e) => { f.onlyNotInApp = e.target.checked; reload(); };
  $('#ld-phone').onchange = (e) => { f.onlyWithPhone = e.target.checked; reload(); };

  $('#ld-search').onclick = async () => {
    const city = $('#ld-city').value.trim();
    const term = $('#ld-term').value.trim();
    const limit = Number($('#ld-limit').value);
    if (city.length < 2 || term.length < 2) { toast('Напиши град и какво търсим.', 'warn'); return; }
    // Същата стойност като PER_PLACE_USD в server/src/lib/leads.ts.
    const est = (limit * 0.02).toFixed(2);
    if (!confirm(`Търсене „${term}“ в ${city} — до ${limit} обекта.\n\nЩе похарчи ~$${est} в Apify. Да продължа?`)) return;
    $('#ld-search').disabled = true;
    try {
      const r = await api('/leads/search', { method: 'POST', body: { city, term, limit } });
      toast(r.message || 'Търсенето тръгна.', 'ok');
      setTimeout(reload, 12000);
    } catch (e) {
      toast(e.message, 'error');
      $('#ld-search').disabled = false;
    }
  };

  $('#ldn-add').onclick = async () => {
    const name = $('#ldn-name').value.trim();
    if (name.length < 2) { toast('Напиши име на обекта.', 'warn'); return; }
    try {
      const r = await api('/leads', { method: 'POST', body: {
        name,
        city: $('#ldn-city').value.trim(),
        address: $('#ldn-addr').value.trim(),
        phone: $('#ldn-phone').value.trim(),
        note: $('#ldn-note').value.trim(),
      } });
      toast(r.message || 'Добавен.', 'ok');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  box.querySelectorAll('.lead-status').forEach((el) => {
    el.onchange = async () => {
      try { await api('/leads/status', { method: 'POST', body: { id: Number(el.dataset.id), status: el.value } }); reload(); }
      catch (e) { toast(e.message, 'error'); }
    };
  });

  box.querySelectorAll('.lead-note').forEach((el) => {
    el.onblur = async () => {
      const row = $(`.lead-status[data-id="${el.dataset.id}"]`);
      try {
        await api('/leads/status', { method: 'POST', body: { id: Number(el.dataset.id), status: row ? row.value : 'new', note: el.value.trim() } });
        toast('Бележката е записана.', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    };
  });

  box.querySelectorAll('.lead-pitch').forEach((el) => {
    el.onclick = async () => {
      const lead = d.items.find((x) => String(x.id) === el.dataset.id);
      if (!lead) return;
      const text = pitchFor(lead);
      try {
        await navigator.clipboard.writeText(text);
        toast('Текстът е копиран — само го постави в Viber/Facebook.', 'ok');
      } catch {
        alert(text);
      }
    };
  });

  box.querySelectorAll('.lead-del').forEach((el) => {
    el.onclick = async () => {
      if (!confirm('Да го махна ли от списъка за обиколки?')) return;
      try { await api('/leads/' + el.dataset.id, { method: 'DELETE' }); reload(); }
      catch (e) { toast(e.message, 'error'); }
    };
  });

  $('#ld-csv').onclick = async () => {
    try {
      const r = await api('/leads.csv');
      const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'obikolki.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { toast(e.message, 'error'); }
  };

  // 🗺️ Маршрут за деня: подрежда спирките по близост и дава готов линк.
  let routeText = '';
  $('#lr-go').onclick = async () => {
    const city = $('#lr-city').value.trim() || f.city;
    if (city.length < 2) { toast('Напиши град за маршрута.', 'warn'); return; }
    $('#lr-go').disabled = true;
    try {
      const r = await api('/leads/route', { method: 'POST', body: { city, maxStops: Number($('#lr-max').value) } });
      if (!r.stops || !r.stops.length) {
        $('#lr-out').innerHTML = `<span class="warn">${esc(r.message || 'Няма обекти с координати в този град.')}</span>`;
        $('#lr-copy').style.display = 'none';
        $('#lr-maps').style.display = 'none';
        return;
      }
      routeText = r.text;
      $('#lr-out').innerHTML =
        `<div><strong>${num(r.stops.length)} спирки · ~${r.totalKm} км по права линия</strong>` +
        `${r.skippedNoCoords ? ` · <span class="dim">${num(r.skippedNoCoords)} обекта без координати останаха извън маршрута</span>` : ''}</div>` +
        `<ol style="margin:8px 0 0 18px">` +
        r.stops.map((s) => `<li><strong>${esc(s.lead.name)}</strong>${s.lead.address ? ' — ' + esc(s.lead.address) : ''}` +
          `${s.lead.phone ? ` · <a href="tel:${esc(s.lead.phone.replace(/[^\d+]/g, ''))}">${esc(s.lead.phone)}</a>` : ''}` +
          `${s.order > 1 ? ` <span class="dim">(${s.kmFromPrev} км)</span>` : ''}</li>`).join('') +
        `</ol>`;
      const maps = $('#lr-maps');
      maps.href = r.mapsUrl;
      maps.style.display = '';
      $('#lr-copy').style.display = '';
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      $('#lr-go').disabled = false;
    }
  };

  $('#lr-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(routeText); toast('Маршрутът е копиран.', 'ok'); }
    catch { alert(routeText); }
  };

  // Ако търсенето още тече — проверяваме пак след малко (във фона е).
  if (running) setTimeout(() => { if (state.page === 'obykolki') reload(); }, 15000);
}

/**
 * 📨 Известия — седмичният дайджест и ръчните съобщения.
 *
 * Защо съществува: приложението имаше Web Push, но нищо не го задействаше само.
 * Тук се вижда колко души са абонирани, пуска се дайджестът (с проба — БЕЗ да
 * праща, за да се проверят числата и текстът) и се пуска ръчно съобщение.
 */
async function renderDigest(box, force = false) {
  const info = await api('/digest/info');
  const last = info.last_run ? dt(info.last_run) : 'още не е пускан';
  const sample = cache.digestSample || [];

  box.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:14px">
      <div class="card kpi"><div class="kpi-label">Абонирани устройства</div><div class="kpi-value cyan">${num(info.devices)}</div></div>
      <div class="card kpi"><div class="kpi-label">Абонирани хора</div><div class="kpi-value">${num(info.users)}</div></div>
      <div class="card kpi"><div class="kpi-label">Находки (7 дни)</div><div class="kpi-value green">${num(info.findings_ready)}</div></div>
      <div class="card kpi"><div class="kpi-label">Града с находки</div><div class="kpi-value gold">${num(info.cities_ready)}</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title">📨 Седмичен дайджест „находки в твоя град“</div>
      <div class="toolbar" style="margin-bottom:10px">
        <span class="pill ${info.enabled ? 'pill-green' : 'pill-dim'}">${info.enabled ? 'включен' : 'изключен'}</span>
        <button class="btn" id="dg-toggle">${info.enabled ? 'Изключи автоматичното' : 'Включи автоматичното'}</button>
        <button class="btn" id="dg-dry">🔍 Проба (без пращане)</button>
        <button class="btn btn-danger" id="dg-send">📤 Пусни сега до хората</button>
      </div>
      <div class="hint">
        Последен пуск: <strong>${esc(last)}</strong> · Пуска се сам всеки <strong>понеделник 09:00</strong>
        българско време (вътре в API-то — не иска cron на сървъра). Всеки абониран получава
        <strong>само своя град</strong>; ако там няма нищо — най-доброто от страната. Максимум 1 известие на седмица.
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title">🧪 Как ще изглежда известието (проба)</div>
      ${
        sample.length
          ? `<div class="table-wrap"><table><thead><tr><th>Град</th><th>Заглавие</th><th>Текст</th></tr></thead><tbody>
              ${sample
                .map(
                  (s) => `<tr><td>${esc(s.city)}</td><td>${esc(s.title)}</td><td class="dim">${esc(s.body)}</td></tr>`
                )
                .join('')}</tbody></table></div>`
          : '<div class="empty">Натисни „🔍 Проба (без пращане)“, за да видиш точните текстове и числа.</div>'
      }
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title">📢 Ръчно известие до всички</div>
      <div class="toolbar">
        <input class="grow" id="bc-title" placeholder="Заглавие (напр. „Нови цени в Кауфланд“)" maxlength="80" />
        <input class="grow" id="bc-body" placeholder="Текст (до 200 знака)" maxlength="200" />
        <input id="bc-url" placeholder="/ (адрес)" maxlength="300" style="width:120px" />
        <button class="btn" id="bc-send">Изпрати</button>
      </div>
      <div class="hint">Стига само до хората, които са разрешили известия. Мъртвите абонаменти се чистят сами.</div>
    </div>

    <div class="card">
      <div class="card-title">📜 История на пусковете</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Кога</th><th>Вид</th><th>Градове</th><th>Находки</th><th>Хора</th><th>Пратени</th><th>Мъртви</th><th>Бележка</th></tr></thead>
        <tbody>
        ${
          (info.history || []).length
            ? info.history
                .map((h) => {
                  const kind =
                    h.trigger === 'dry' ? ['проба', 'pill-dim'] : h.trigger === 'manual' ? ['ръчно', 'pill-gold'] : ['автоматично', 'pill-green'];
                  return `<tr>
                    <td class="mono dim nowrap">${dt(h.run_at)}</td>
                    <td><span class="pill ${kind[1]}">${kind[0]}</span></td>
                    <td>${num(h.cities)}</td>
                    <td>${num(h.findings)}</td>
                    <td>${num(h.targeted)}</td>
                    <td>${num(h.sent)}</td>
                    <td>${num(h.gone)}</td>
                    <td class="dim">${esc(h.note || '')}</td>
                  </tr>`;
                })
                .join('')
            : '<tr><td colspan="8" class="empty">Още няма пускове</td></tr>'
        }
        </tbody></table></div>
      <div class="hint" style="margin-top:10px">
        ⚠️ За да получава някой известия, трябва да е натиснал „🔔 Включи известията“ в профила си
        (на iPhone — приложението трябва да е сложено на началния екран, иначе Safari не дава известия).
      </div>
    </div>`;

  $('#dg-toggle').addEventListener('click', async () => {
    try {
      const res = await api('/digest/toggle', { method: 'POST', body: { enabled: !info.enabled } });
      toast(res.enabled ? 'Автоматичният дайджест е включен' : 'Автоматичният дайджест е изключен');
    } catch (e) {
      toast(e.message, 'error');
    }
    render('digest', true);
  });

  $('#dg-dry').addEventListener('click', async () => {
    try {
      const res = await api('/digest/run', { method: 'POST', body: { dryRun: true, days: 7 } });
      cache.digestSample = res.sample || [];
      toast(res.note);
    } catch (e) {
      toast(e.message, 'error');
    }
    render('digest', true);
  });

  $('#dg-send').addEventListener('click', async () => {
    if (
      !confirm(
        'Да пусна ли седмичния дайджест ДО ХОРАТА сега?\n\nВсеки абониран получава известие за находките в своя град.'
      )
    )
      return;
    try {
      const res = await api('/digest/run', { method: 'POST', body: { dryRun: false, days: 7 } });
      toast(res.note);
    } catch (e) {
      toast(e.message, 'error');
    }
    render('digest', true);
  });

  $('#bc-send').addEventListener('click', async () => {
    const title = $('#bc-title').value.trim();
    const body = $('#bc-body').value.trim();
    if (title.length < 3 || body.length < 3) {
      toast('Нужни са заглавие и текст', 'error');
      return;
    }
    if (!confirm('Да изпратя ли това известие до всички абонирани?')) return;
    try {
      const res = await api('/push/broadcast', {
        method: 'POST',
        body: { title, body, url: $('#bc-url').value.trim() || '/' },
      });
      toast(res.message);
      $('#bc-title').value = '';
      $('#bc-body').value = '';
    } catch (e) {
      toast(e.message, 'error');
    }
    render('digest', true);
  });
}

/* ----------------------------------------------------------- любими */

/**
 * Бонус за основатели. Идеята: докато сайтът е още празен, първата находка
 * на нов човек се награждава веднага (значка „Основател“ + точки), за да
 * има причина да качи нещо още в първите минути. Щом базата се напълни,
 * бонусът се изключва оттук.
 */
async function renderFounder(box) {
  const data = await api('/founder');
  box.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:14px">
      <div class="card kpi"><div class="kpi-label">Издадени значки „Основател“</div><div class="kpi-value gold">${num(data.awarded)}</div></div>
      <div class="card kpi"><div class="kpi-label">Прозорец</div><div class="kpi-value cyan">${num(data.windowMin)} мин</div></div>
      <div class="card kpi"><div class="kpi-label">Бонус точки</div><div class="kpi-value">${num(data.points)}</div></div>
    </div>

    <div class="card" style="border-color:${data.enabled ? 'rgba(34,197,94,.55)' : 'rgba(148,163,184,.35)'}">
      <div class="card-title">${data.enabled ? '🟢 Бонусът за основатели е ВКЛЮЧЕН' : '⚪ Бонусът за основатели е изключен'}</div>
      <div class="hint" style="margin:8px 0 12px">
        ${data.enabled
          ? 'Всеки нов потребител, който качи първата си находка в рамките на ' + num(data.windowMin) + ' минути от регистрацията, получава значка „Основател“ и ' + num(data.points) + ' точки.'
          : 'Сега никой не получава значката. Включи го, докато базата още е празна — иначе новите хора няма причина да качат първата си находка.'}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="max-width:160px"><span>Прозорец (мин.)</span>
          <input id="f-win" type="number" min="1" max="120" value="${num(data.windowMin)}"></label>
        <label class="field" style="max-width:160px"><span>Бонус точки</span>
          <input id="f-points" type="number" min="0" max="10000" value="${num(data.points)}"></label>
        <button class="btn btn-ok" id="f-save">Запази</button>
        <button class="btn ${data.enabled ? 'btn-danger' : 'btn-ok'}" id="f-toggle">
          ${data.enabled ? 'Изключи бонуса' : 'Включи бонуса'}
        </button>
      </div>
    </div>`;

  $('#f-save')?.addEventListener('click', async () => {
    const windowMin = Number($('#f-win').value);
    const points = Number($('#f-points').value);
    if (!Number.isFinite(windowMin) || windowMin < 1 || windowMin > 120) return toast('Прозорецът е между 1 и 120 минути');
    if (!Number.isFinite(points) || points < 0 || points > 10000) return toast('Точките са между 0 и 10000');
    await api('/founder', { method: 'POST', body: { windowMin, points } });
    toast('Настройките са запазени');
    render('founder', true);
  });

  $('#f-toggle')?.addEventListener('click', async () => {
    await api('/founder', { method: 'POST', body: { enabled: !data.enabled } });
    toast(data.enabled ? 'Бонусът е изключен' : 'Бонусът е включен');
    render('founder', true);
  });
}

const SOURCE_TITLES = {
  user: 'От потребители',
  receipt_basket: 'Кошче на касата',
  brochure: 'Официална брошура',
  tiktok_signal: 'Сигнал от TikTok (с разрешение)',
  import: 'Друг внос',
};

/**
 * Внасяне на реални бонове.
 *
 * Идеята: вместо да чакаме органични потребители, събираме изхвърлените бонове
 * от кошчетата до касите и ги внасяме наведнъж. Всичко влиза под профил
 * „SmartPrice Редакция“ и носи етикет за източника — така е ясно, че това не са
 * потребителски отзиви, а реални касови бележки, внесени от нас.
 */
async function renderImport(box, force) {
  const data = await api('/import/info');
  const total = (data.bySource || []).reduce((s, r) => s + Number(r.count), 0);
  const imported = (data.bySource || [])
    .filter((r) => r.source !== 'user')
    .reduce((s, r) => s + Number(r.count), 0);

  box.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:14px">
      <div class="card kpi"><div class="kpi-label">Всички оферти</div><div class="kpi-value">${num(total)}</div></div>
      <div class="card kpi"><div class="kpi-label">Внесени от Редакцията</div><div class="kpi-value gold">${num(imported)}</div></div>
      <div class="card kpi"><div class="kpi-label">От потребители</div><div class="kpi-value cyan">${num(total - imported)}</div></div>
    </div>

    <div class="card">
      <div class="card-title">🗂 Откъде идват цените</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Източник</th><th>Брой оферти</th></tr></thead>
        <tbody>
        ${
          (data.bySource || []).length
            ? data.bySource
                .map(
                  (r) => `<tr>
              <td>${esc(SOURCE_TITLES[r.source] || r.source)}</td>
              <td>${num(r.count)}</td>
            </tr>`
                )
                .join('')
            : '<tr><td colspan="2" class="empty">Още няма оферти</td></tr>'
        }
        </tbody></table></div>
    </div>

    <div class="card">
      <div class="card-title">🧾 Как се внасят бонове (методът „кошче на касата“)</div>
      <div class="hint" style="margin:8px 0 12px">
        Внасяш под профил <strong>${esc((data.official || {}).name || 'SmartPrice Редакция')}</strong>
        (@${esc((data.official || {}).handle || 'smartprice_bg')}) — не под твоя. Така всички виждат,
        че това са реални касови бонове, внесени от редакцията, а не потребителски отзиви.
        Личните данни по боновете (карта, IBAN, дълги номера) се маскират автоматично.
      </div>
      <div class="hint" style="margin-bottom:10px">
        1) Събираш шепа изхвърлени бонове от кошчето до касите.<br>
        2) Гледаш ги с AI скенера (или ги въвеждаш на ръка) и ги записваш в <code>receipts.json</code>.<br>
        3) Пускаш скрипта — внася по 25 на заявка и казва какво е отказано.
      </div>
      <pre style="background:#0B0F1A;border:1px solid rgba(148,163,184,.2);border-radius:12px;padding:12px;overflow:auto;font-size:12.5px;color:#CBD5E1">cd C:\Dockers\SmartPrice\server
python import_receipts.py --example &gt; receipts.json     # шаблон
python import_receipts.py --file receipts.json          # проба (нищо не се качва)
python import_receipts.py --file receipts.json --commit  # внася наистина</pre>
      <div class="hint warn" style="margin-top:10px">
        Паролата се подава с <code>--password</code> или през променливата
        <code>SMART_PRICE_ADMIN_PASSWORD</code>. Никъде не се записва във файл.
      </div>
    </div>`;
}

/* ------------------------------------------- Фейсбук касови бележки */

let fbReceiptsFilter = 'pending';
/** 🔎 Думи за търсене в бележките (пише ги човекът в полето). */
let fbReceiptsQuery = '';
let fbReceiptsTopic = '';
let fbFlaggedOnly = false;
/** Заглавия на темите (интересите) — за етикетите в опашката. */
const FB_TOPIC_TITLES = {
  deals: '🏷️ Оферти и цени',
  services: '🔧 Услуги',
  masters: '👷 Майстори',
  real_estate: '🏠 Имоти',
  vehicles: '🚗 Авто',
  shops_places: '🏪 Обекти',
  private_sellers: '🧍 Частни продавачи',
};
let fbReceiptsPolarity = '';
let fbReceiptsSelected = new Set();
let fbReceiptsJobPoll = null;
let fbReceiptsLastGroupUrl = 'https://www.facebook.com/groups/3111975342346393';
let fbReceiptsLastCount = 10;
let fbReceiptsLastCity = 'София';

/* ===== Otkriti novi grupi (podobrenie 9) ===== */
async function loadFbCandidates() {
  const box = document.getElementById('fb-cand-list');
  if (!box) return;
  try {
    const d = await api('/fb-receipts/groups/candidates?status=pending');
    const list = Array.isArray(d && d.candidates) ? d.candidates : [];
    if (!list.length) {
      box.innerHTML = '<div class="hint" style="margin:0">Няма нови групи за преглед. Натисни „Търси нови групи“.</div>';
      return;
    }
    const head = '<div class="hint" style="margin:0 0 6px">Чакат одобрение: <strong>' + num(list.length) + '</strong> — най-подходящите са отгоре.</div>';
    const rows = list.map(function (c) {
      const members = c.member_count ? num(c.member_count) + ' членове' : 'членове: няма данни';
      const priv = c.privacy === 'private' ? '<span class="pill pill-red">затворена</span>' : '<span class="pill pill-green">публична</span>';
      return '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid rgba(148,163,184,.25);border-radius:10px;margin-bottom:6px">' +
        '<div style="min-width:0">' +
          '<div style="font-weight:700">' + esc(c.name || '—') +
            ' <span class="pill pill-dim">' + members + '</span> ' + priv +
            ' <span class="pill pill-cyan">резултат ' + num(c.score) + '</span>' +
          '</div>' +
          '<div class="hint" style="margin:2px 0 0;word-break:break-all">' + esc(c.group_url) + ' · търсено с: „' + esc(c.query || '—') + '“</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0">' +
          '<button class="btn btn-sm btn-ok" data-fb-cand-ok="' + Number(c.id) + '">Добави</button>' +
          '<button class="btn btn-sm btn-ghost" data-fb-cand-no="' + Number(c.id) + '">Отхвърли</button>' +
        '</div></div>';
    }).join('');
    box.innerHTML = head + rows;
    box.querySelectorAll('[data-fb-cand-ok]').forEach(function (btn) {
      btn.onclick = function () { fbCandAct(Number(btn.dataset.fbCandOk), 'approve'); };
    });
    box.querySelectorAll('[data-fb-cand-no]').forEach(function (btn) {
      btn.onclick = function () { fbCandAct(Number(btn.dataset.fbCandNo), 'reject'); };
    });
  } catch (e) {
    box.innerHTML = '<div class="hint" style="margin:0">Грешка при зареждане: ' + esc(e.message) + '</div>';
  }
}

async function fbCandAct(id, action) {
  try {
    const r = await api('/fb-receipts/groups/candidates/' + id, {
      method: 'POST',
      body: JSON.stringify({ action: action }),
    });
    if (action === 'approve') {
      toast('Групата е добавена към обиколките (общо ' + (r && r.groups ? r.groups : '?') + ' групи).', 'ok');
    } else {
      toast('Групата е отхвърлена — повече няма да се предлага.', 'ok');
    }
    await loadFbCandidates();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ===== ⏱️ График на обиколките (по група) ===== */
let fbPlanData = null;

function planRow(p) {
  const last = p.last_run_at ? String(p.last_run_at).slice(0, 16).replace('T', ' ') : 'още не е пускана';
  const dueBadge = p.due ? '<span class="pill pill-green">време е</span>' : '<span class="pill pill-dim">' + esc(p.reason || '—') + '</span>';
  return '<tr>' +
    '<td>' +
      '<label style="display:flex;gap:6px;align-items:center;cursor:pointer">' +
        '<input type="checkbox" data-p-en="' + p.id + '" ' + (p.enabled ? 'checked' : '') + '>' +
        '<span style="font-weight:700">' + esc(p.name || '—') + '</span></label>' +
      '<div class="hint" style="margin:2px 0 0;word-break:break-all">' + esc(p.group_url) + '</div>' +
      '<div class="hint" style="margin:2px 0 0">' + dueBadge + ' · днес ' + num(p.posts_today) + ' поста · обиколки ' +
        num(p.runs_today) + '/' + num(p.runs_per_day) + ' · всичко ' + num(p.total_posts) + ' · последно: ' + esc(last) + '</div>' +
      (p.notes ? '<div class="hint" style="margin:2px 0 0">' + esc(p.notes) + '</div>' : '') +
    '</td>' +
    '<td><input type="number" min="1" max="100" style="width:62px" data-p-posts="' + p.id + '" value="' + Number(p.posts_per_run) + '"></td>' +
    '<td><input type="number" min="1" max="12" style="width:54px" data-p-runs="' + p.id + '" value="' + Number(p.runs_per_day) + '"></td>' +
    '<td><input style="width:150px" data-p-hours="' + p.id + '" value="' + esc(p.hours) + '" title="Часове, разделени със запетая, напр. 07:30, 19:30"></td>' +
    '<td><input type="number" min="0" max="2000" style="width:66px" data-p-max="' + p.id + '" value="' + Number(p.max_posts_per_day) + '" title="0 = без таван"></td>' +
    '<td><input type="number" min="1" max="10" style="width:54px" data-p-prio="' + p.id + '" value="' + Number(p.priority) + '" title="1 = най-нисък, 10 = първо се пуска"></td>' +
    '<td><input style="width:104px" data-p-city="' + p.id + '" value="' + esc(p.default_city || '') + '" placeholder="София"></td>' +
    '<td style="white-space:nowrap">' +
      '<button class="btn btn-sm btn-ok" data-p-save="' + p.id + '" title="Запази">💾</button> ' +
      '<button class="btn btn-sm" data-p-run="' + p.id + '" title="Пусни сега">▶</button> ' +
      '<button class="btn btn-sm btn-ghost" data-p-del="' + p.id + '" title="Махни от графика">✕</button>' +
    '</td>' +
  '</tr>';
}

async function loadPlans(force) {
  const box = document.getElementById('fb-plan-box');
  if (!box) return;
  if (force !== false || !fbPlanData) {
    try {
      fbPlanData = await api('/fb-receipts/plans');
    } catch (e) {
      box.innerHTML = '<div class="hint" style="margin:0">Грешка: ' + esc(e.message) + '</div>';
      return;
    }
  }
  const d = fbPlanData || {};
  const cfg = d.settings || {};
  const status = d.status || {};
  const plans = Array.isArray(d.plans) ? d.plans : [];
  const dueCount = plans.filter(function (x) { return x.due; }).length;

  box.innerHTML =
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
      '<span class="pill ' + (cfg.autoEnabled ? 'pill-green' : 'pill-red') + '">автоматика: ' + (cfg.autoEnabled ? 'включена' : 'спряна') + '</span>' +
      '<span class="pill pill-dim">днес: ' + num(status.postsToday || 0) + ' поста · ' + num(status.runsToday || 0) + ' обиколки</span>' +
      '<span class="pill pill-dim">групи: ' + num(plans.length) + ' (включени ' + num(plans.filter(function (x) { return x.enabled; }).length) + ')</span>' +
      '<span class="pill ' + (dueCount ? 'pill-cyan' : 'pill-dim') + '">чакат ред: ' + num(dueCount) + '</span>' +
      (status.running ? '<span class="pill pill-green">диспечер: върви</span>' : '<span class="pill pill-dim">диспечер: свободен</span>') +
      '<button class="btn btn-sm btn-ok" id="fb-plan-dispatch">▶ Пусни чакащите сега</button>' +
      '<button class="btn btn-sm btn-ghost" id="fb-plan-refresh">🔄 презареди</button>' +
    '</div>' +

    '<div class="form-grid" style="margin-bottom:10px">' +
      '<label class="field" style="max-width:120px"><span>Включи автоматиката</span><input type="checkbox" id="fb-plan-auto" ' + (cfg.autoEnabled ? 'checked' : '') + '></label>' +
      '<label class="field" style="max-width:150px"><span>Таван постове на ден (общо)</span><input type="number" min="0" max="5000" id="fb-plan-cap" value="' + Number(cfg.dailyPostCap || 0) + '"></label>' +
      '<label class="field" style="max-width:150px"><span>Случайно закъснение (мин)</span><input type="number" min="0" max="60" id="fb-plan-jitter" value="' + Number(cfg.jitterMin || 0) + '"></label>' +
      '<label class="field" style="max-width:170px"><span>Спри при опашка над</span><input type="number" min="0" max="5000" id="fb-plan-queue" value="' + Number(cfg.maxPendingQueue || 0) + '"></label>' +
      '<label class="field" style="max-width:120px"><span>Нощна пауза от</span><input id="fb-plan-night-from" value="' + esc(cfg.nightFrom || '23:00') + '"></label>' +
      '<label class="field" style="max-width:120px"><span>до</span><input id="fb-plan-night-to" value="' + esc(cfg.nightTo || '07:00') + '"></label>' +
      '<label class="field" style="max-width:150px"><span>Нощна пауза</span><input type="checkbox" id="fb-plan-night" ' + (cfg.nightPause ? 'checked' : '') + '></label>' +
      '<label class="field" style="max-width:170px"><span>Пълен стоп до (дата)</span><input id="fb-plan-paused" value="' + esc(cfg.pausedUntil || '') + '" placeholder="2026-11-01 или празно"></label>' +
      '<label class="field" style="max-width:220px"><span>Причина за стопа</span><input id="fb-plan-pause-reason" value="' + esc(cfg.pauseReason || '') + '" placeholder="напр. отпуска"></label>' +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">' +
      '<button class="btn btn-sm btn-ok" id="fb-plan-save-settings">💾 Запази настройките</button>' +
      '<span class="hint" style="margin:0">Диспечерът се пуска сам на всеки 10 минути от сървъра и обикаля само групите, на които им е дошло времето.</span>' +
    '</div>' +

    '<div class="form-grid" style="margin-bottom:12px;padding:10px 12px;border:1px solid rgba(148,163,184,.25);border-radius:12px">' +
      '<div class="field full"><span style="font-weight:700">➕ Добави / обнови група в графика</span></div>' +
      '<label class="field" style="grid-column:span 2"><span>Адрес на групата</span><input id="fb-plan-url" placeholder="https://www.facebook.com/groups/3111975342346393"></label>' +
      '<label class="field" style="max-width:200px"><span>Име (по избор)</span><input id="fb-plan-name" placeholder="Обяви София"></label>' +
      '<label class="field" style="max-width:120px"><span>Поста на обиколка</span><input type="number" min="1" max="100" id="fb-plan-posts" value="10"></label>' +
      '<label class="field" style="max-width:110px"><span>Обиколки на ден</span><input type="number" min="1" max="12" id="fb-plan-runs" value="2"></label>' +
      '<label class="field" style="max-width:200px"><span>Часове</span><input id="fb-plan-hours" value="07:30, 19:30"></label>' +
      '<label class="field" style="max-width:110px"><span>Приоритет 1-10</span><input type="number" min="1" max="10" id="fb-plan-prio" value="5"></label>' +
      '<label class="field" style="max-width:140px"><span>Град по подразбиране</span><input id="fb-plan-city" value="София"></label>' +
      '<div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-sm btn-ok" id="fb-plan-add">➕ Добави в графика</button></div>' +
    '</div>' +

    '<div style="overflow-x:auto"><table class="table"><thead><tr>' +
      '<th>Група</th><th>Поста/обиколка</th><th>Обиколки/ден</th><th>Часове</th><th>Макс/ден</th><th>Приоритет</th><th>Град</th><th></th>' +
    '</tr></thead><tbody>' +
    (plans.length ? plans.map(planRow).join('') : '<tr><td colspan="8"><span class="hint">Още няма групи в графика. Добави първата от формата по-горе.</span></td></tr>') +
    '</tbody></table></div>';

  const $ = function (id) { return document.getElementById(id); };

  if ($('fb-plan-refresh')) $('fb-plan-refresh').onclick = function () { void loadPlans(true); };

  if ($('fb-plan-dispatch')) $('fb-plan-dispatch').onclick = async function () {
    try {
      const r = await api('/fb-receipts/plans/dispatch', { method: 'POST', body: JSON.stringify({ force: true }) });
      if (!r.ok) toast(r.reason || 'Не можа да се пусне.', 'err');
      else toast('Пуснати ' + r.started.length + ' групи' + (r.skipped.length ? ' · пропуснати ' + r.skipped.length : '') + '.', 'ok');
      void loadPlans(true);
    } catch (e) { toast(e.message, 'err'); }
  };

  if ($('fb-plan-save-settings')) $('fb-plan-save-settings').onclick = async function () {
    try {
      await api('/fb-receipts/plans/settings', {
        method: 'POST',
        body: JSON.stringify({
          autoEnabled: document.getElementById('fb-plan-auto').checked,
          dailyPostCap: Number(document.getElementById('fb-plan-cap').value),
          jitterMin: Number(document.getElementById('fb-plan-jitter').value),
          maxPendingQueue: Number(document.getElementById('fb-plan-queue').value),
          nightPause: document.getElementById('fb-plan-night').checked,
          nightFrom: document.getElementById('fb-plan-night-from').value,
          nightTo: document.getElementById('fb-plan-night-to').value,
          pausedUntil: document.getElementById('fb-plan-paused').value.trim() || null,
          pauseReason: document.getElementById('fb-plan-pause-reason').value.trim() || null,
        }),
      });
      toast('Настройките на графика са запазени.', 'ok');
      void loadPlans(true);
    } catch (e) { toast(e.message, 'err'); }
  };

  if ($('fb-plan-add')) $('fb-plan-add').onclick = async function () {
    const url = document.getElementById('fb-plan-url').value.trim();
    if (!url) { toast('Дай адрес на група.', 'err'); return; }
    try {
      await api('/fb-receipts/plans', {
        method: 'POST',
        body: JSON.stringify({
          group_url: url,
          name: document.getElementById('fb-plan-name').value.trim() || undefined,
          posts_per_run: Number(document.getElementById('fb-plan-posts').value),
          runs_per_day: Number(document.getElementById('fb-plan-runs').value),
          hours: document.getElementById('fb-plan-hours').value,
          priority: Number(document.getElementById('fb-plan-prio').value),
          default_city: document.getElementById('fb-plan-city').value.trim() || undefined,
          enabled: true,
        }),
      });
      toast('Групата е в графика.', 'ok');
      void loadPlans(true);
    } catch (e) { toast(e.message, 'err'); }
  };

  box.querySelectorAll('[data-p-save]').forEach(function (btn) {
    btn.onclick = async function () {
      const id = Number(btn.dataset.pSave);
      const plan = (fbPlanData.plans || []).filter(function (x) { return Number(x.id) === id; })[0];
      if (!plan) return;
      const val = function (attr) { const el = box.querySelector('[data-' + attr + '="' + id + '"]'); return el ? el.value : ''; };
      try {
        await api('/fb-receipts/plans', {
          method: 'POST',
          body: JSON.stringify({
            group_url: plan.group_url,
            name: plan.name || undefined,
            posts_per_run: Number(val('p-posts')),
            runs_per_day: Number(val('p-runs')),
            hours: val('p-hours'),
            max_posts_per_day: Number(val('p-max')),
            priority: Number(val('p-prio')),
            default_city: val('p-city').trim() || undefined,
            enabled: plan.enabled,
          }),
        });
        toast('Записано.', 'ok');
        void loadPlans(true);
      } catch (e) { toast(e.message, 'err'); }
    };
  });

  box.querySelectorAll('[data-p-en]').forEach(function (el) {
    el.onchange = async function () {
      try {
        await api('/fb-receipts/plans/' + Number(el.dataset.pEn) + '/enabled', {
          method: 'POST',
          body: JSON.stringify({ enabled: el.checked }),
        });
        toast(el.checked ? 'Групата е включена.' : 'Групата е изключена.', 'ok');
        void loadPlans(true);
      } catch (e) { toast(e.message, 'err'); }
    };
  });

  box.querySelectorAll('[data-p-run]').forEach(function (btn) {
    btn.onclick = async function () {
      btn.disabled = true;
      try {
        await api('/fb-receipts/plans/' + Number(btn.dataset.pRun) + '/run', { method: 'POST', body: JSON.stringify({}) });
        toast('Обиколката стартира — след минута ще видиш новите записи в опашката.', 'ok');
        setTimeout(function () { void loadPlans(true); }, 15000);
      } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; }
    };
  });

  box.querySelectorAll('[data-p-del]').forEach(function (btn) {
    btn.onclick = async function () {
      const id = Number(btn.dataset.pDel);
      const plan = (fbPlanData.plans || []).filter(function (x) { return Number(x.id) === id; })[0] || {};
      confirmAction({
        title: 'Махни групата от графика',
        message: 'Групата спира да се обхожда автоматично. Вече публикуваното остава в приложението.',
        details: ['Група: ' + esc(plan.name || plan.group_url || ('#' + id))],
        confirmLabel: 'Махни',
        onConfirm: async function () {
          closeModal();
          try {
            await api('/fb-receipts/plans/' + id, { method: 'DELETE' });
            toast('Групата е махната от графика.', 'ok');
            void loadPlans(true);
          } catch (e) { toast(e.message, 'err'); }
        },
      });
    };
  });
}

function stopFbReceiptsPoll() {
  if (fbReceiptsJobPoll) {
    clearInterval(fbReceiptsJobPoll);
    fbReceiptsJobPoll = null;
  }
}

async function renderFbReceipts(box) {
  stopFbReceiptsPoll();
  const data = await api(
    `/fb-receipts/info?status=${encodeURIComponent(fbReceiptsFilter)}&limit=60` +
      `&topic=${encodeURIComponent(fbReceiptsTopic)}&q=${encodeURIComponent(fbReceiptsQuery)}`
  );
  const keywords = Array.isArray(data?.keywords) ? data.keywords : [];
  const topicsAll = Array.isArray(data?.topics?.all) ? data.topics.all : [];
  const topicsEnabled = Array.isArray(data?.topics?.enabled) ? data.topics.enabled : [];
  const cost = data?.cost || {};
  const flaggedCount = (data?.items || []).filter((it) => it.flagged).length;
  const cfg = data.config || {};
  const counts = data.counts || { pending: 0, approved: 0, rejected: 0, not_receipt: 0 };
  const jobs = data.jobs || [];
  const items = data.items || [];
  const runningJob = jobs.find((j) => j.status === 'running');

  // Генерираме 1-клик Bookmarklet / браузърен колектор, който изпраща видимите постове от отворена ФБ група директно към панела
  const apiOrigin = window.location.origin;
  const collectorScript = `(async()=>{try{const articles=[...document.querySelectorAll('[role="article"]')];const posts=[];const seen=new Set();for(const a of articles){const imgs=[...a.querySelectorAll('img')].map(i=>i.src).filter(s=>s&&/scontent|fbcdn/i.test(s)&&!/emoji|p50x50|s100x100|rsrc\\.php/i.test(s));if(!imgs.length)continue;const key=imgs[0];if(seen.has(key))continue;seen.add(key);const textEl=a.querySelector('[data-ad-preview="message"],[dir="auto"]');const text=(a.innerText||'').split('\\n').filter(l=>l.trim().length>3&&!/^(Like|Comment|Share|Харесва ми|Коментар|Споделяне)$/i.test(l.trim())).slice(0,12).join('\\n');const linkEl=[...a.querySelectorAll('a[href*="/posts/"],a[href*="story_fbid"],a[href*="/photo"]')][0];posts.push({postUrl:linkEl?linkEl.href:location.href,text:textEl?textEl.innerText:text,imageUrls:imgs.slice(0,3)});if(posts.length>=25)break;}if(!posts.length){alert('Не намерих постове със снимки на екрана. Скролни малко надолу в групата и опитай пак.');return;}const r=await fetch('${apiOrigin}/api/admin/fb-receipts/ingest',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${state.token}'},body:JSON.stringify({groupUrl:location.href,posts})});const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Грешка');alert('SmartPrice: Разчетени за одобрение: '+d.queued+' бележки (пропуснати: '+d.skipped+')');}catch(e){alert('Грешка: '+e.message);}})();`;
  const bookmarkletHref = `javascript:${encodeURIComponent(collectorScript)}`;

  box.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:14px">
      <div class="card kpi"><div class="kpi-label">Чакат одобрение</div><div class="kpi-value gold">${num(counts.pending)}</div><div class="kpi-sub">разчетени бележки</div></div>
      <div class="card kpi"><div class="kpi-label">Одобрени и публикувани</div><div class="kpi-value green">${num(counts.approved)}</div><div class="kpi-sub">в приложението</div></div>
      <div class="card kpi"><div class="kpi-label">Отхвърлени</div><div class="kpi-value">${num(counts.rejected)}</div><div class="kpi-sub">${num(counts.not_receipt)} без касов бон</div></div>
      <div class="card kpi"><div class="kpi-label">AI Vision OCR</div><div class="kpi-value cyan">${cfg.ocrAvailable ? 'активен' : 'липсва ключ'}</div><div class="kpi-sub">${esc(cfg.ocrModel || '—')}</div></div>
    </div>

    <div class="card" style="border-color:rgba(6,182,212,.45);margin-bottom:14px">
      <div class="card-title">📘 Сваляне от публична Facebook група (оферти, услуги, имоти, обекти, майстори…)</div>
      <div class="hint" style="margin:6px 0 12px">
        Дай адрес на публична Facebook група (напр. <code>https://www.facebook.com/groups/3111975342346393</code>).
        Системата сваля постовете със снимки и текста към тях, чете с AI какво има на снимката
        (касова бележка, етикет с цена, табела, обява, обект) и го преразказва в стила на SmartPrice —
        с ясно място (град + обект), псевдоним вместо име и цени в €. Влиза само това, което покрива
        <strong>избраните по-долу теми</strong>, и нищо не се публикува без твоето одобрение.
      </div>

      <div class="form-grid">
        <label class="field full"><span>Адрес на публична Facebook група (или пост)</span>
          <input id="fb-group-url" value="${esc(fbReceiptsLastGroupUrl)}" placeholder="https://www.facebook.com/groups/3111975342346393"></label>
        <label class="field" style="max-width:200px"><span>Колко поста да провери</span>
          <input id="fb-count" type="number" min="1" max="100" value="${Number(fbReceiptsLastCount || 10)}"></label>
        <label class="field" style="max-width:220px"><span>Град по подразбиране</span>
          <input id="fb-city" value="${esc(fbReceiptsLastCity)}" placeholder="София"></label>
      </div>

      <div class="field full" style="margin-top:12px">
        <span><strong>Какво да търсим във Facebook групите (теми)</strong> — всяка тема се обработва по същия начин:
        AI-ят преразказва на български, слага псевдоним вместо име, иска ясно място (град + обект) и прави цените в €.
        Пост без ясно място или без цена не влиза.</span>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px;margin-top:8px">
          ${topicsAll
            .map(
              (tp) => `<label style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid rgba(148,163,184,.25);border-radius:10px;cursor:pointer">
              <input type="checkbox" class="fb-topic-key" value="${esc(tp.key)}" ${topicsEnabled.includes(tp.key) ? 'checked' : ''} style="margin-top:3px">
              <span>
                <span style="font-weight:700">${tp.emoji || ''} ${esc(tp.title)}</span>
                <span class="hint" style="display:block;margin-top:2px">${esc(tp.hint || '')}</span>
              </span>
            </label>`
            )
            .join('')}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;align-items:center">
          <button class="btn btn-sm btn-ok" id="fb-save-topics">💾 Запази темите</button>
          <button class="btn btn-sm btn-ghost" id="fb-topics-all">Избери всички теми</button>
          <span class="hint" style="margin:0">Включени сега: <strong>${
            topicsEnabled.length
              ? topicsEnabled.map((k) => FB_TOPIC_TITLES[k] || k).join(' · ')
              : '— (само „Оферти и цени“ по подразбиране)'
          }</strong></span>
        </div>
      </div>

      <div class="field full" style="margin-top:14px;padding:10px 12px;border:1px solid rgba(34,197,94,.35);border-radius:12px;background:rgba(34,197,94,.06)">
        <span><strong>🔎 Ключови думи (пишеш ги сам)</strong> — освен готовите теми горе, тук можеш да напишеш
        конкретни думи, които търсиш в групата (напр. <em>касова бележка, касов бон, промоция</em>).
        <strong>Системата търси тези думи САМА при всяка обиколка на групата</strong> — както търси оферти и цени,
        без да натискаш нищо. Думата се ползва и за търсене в бележките долу, дава пряк линк за ръчна проверка
        и се подсказва на AI-я като „търсим специално това“.</span>
        <label class="field full" style="margin-top:8px"><span>Думи (по един ред или със запетая)</span>
          <textarea id="fb-keywords" rows="2" placeholder="касова бележка, касов бон, промоция">${esc(keywords.join(', '))}</textarea></label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;align-items:center">
          <button class="btn btn-sm btn-ok" id="fb-save-keywords">💾 Запази думите</button>
          <span class="hint" style="margin:0">Записани сега: <strong>${keywords.length ? esc(keywords.join(' · ')) : '— още няма'}</strong></span>
        </div>
        ${
          keywords.length
            ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">
                 ${keywords
                   .map(
                     (k) =>
                       `<button class="btn btn-sm btn-ghost" data-fb-search="${esc(k)}">🔎 Търси „${esc(k)}“ в групата</button>`
                   )
                   .join('')}
                 <span class="hint" style="margin:0">Отваря търсенето в групата (в нов раздел) — там плъзни бутона
                 „📌 Прати от FB група“ и постовете с тази дума идват тук.</span>
               </div>`
            : ''
        }
      </div>

      <div class="field full" style="margin-top:14px;padding:10px 12px;border:1px solid rgba(168,85,247,.35);border-radius:12px;background:rgba(168,85,247,.06)">
        <span><strong>⏱️ График на обиколките</strong> — за всяка група: колко поста да свали, колко пъти на ден,
        в кои часове, таван на ден, приоритет и град. Сървърът пуска сам само групите, на които им е дошло времето.</span>
        <div id="fb-plan-box" style="margin-top:10px"></div>
      </div>

      <div class="field full" style="margin-top:14px;padding:10px 12px;border:1px solid rgba(56,189,248,.35);border-radius:12px;background:rgba(56,189,248,.07)">
        <span><strong>🔎 Откриване на нови групи</strong> — Apify търси публични Facebook групи по ключови думи
        (градове + теми). Намереното пада тук за преглед; одобреното влиза в обиколките.</span>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px">
          <button class="btn btn-sm btn-ok" id="fb-discover-btn">🔎 Търси нови групи</button>
          <span class="hint" style="margin:0" id="fb-discover-status">—</span>
        </div>
        <div id="fb-cand-list" style="margin-top:10px"></div>
      </div>

      <div class="field full" style="margin-top:14px;padding:10px 12px;border:1px solid rgba(250,204,21,.35);border-radius:12px;background:rgba(250,204,21,.06)">
        <span><strong>💰 Дневен бюджет за Apify</strong> — спираме обиколките, когато се похарчи лимитът за деня.</span>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px">
          <span class="pill ${Number(cost.todayUsd || 0) >= Number(cost.limitUsd || 0) ? 'pill-red' : 'pill-green'}">
            днес: $${Number(cost.todayUsd || 0).toFixed(2)} от $${Number(cost.limitUsd || 0.5).toFixed(2)}
          </span>
          <span class="pill pill-dim">този месец: $${Number(cost.monthUsd || 0).toFixed(2)}</span>
          <span class="pill pill-dim">днес: ${Number(cost.todayPosts || 0)} поста · ${Number(cost.todayAi || 0)} AI заявки</span>
          <input id="fb-daily-limit" type="number" min="0" max="50" step="0.05" value="${Number(cost.limitUsd || 0.5)}" style="width:110px">
          <button class="btn btn-sm btn-ok" id="fb-save-cost">💾 Запази лимита</button>
          <span class="hint" style="margin:0">Съвет: при план $5/месец в Apify дръж лимита ~$0.15 на ден.</span>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center">
        <button class="btn btn-primary" id="fb-run-btn">▶ Свали и обработи постовете</button>
        <button class="btn" id="fb-manual-btn">➕ Подай пост / снимка на бележка</button>
        <span class="hint" style="margin:0">
          Връзка с Facebook:
          ${cfg.hasApifyToken ? `<span class="pill pill-green">Apify активен (${esc(cfg.apifyTokenMasked)})</span>` : '<span class="pill pill-dim">Apify не е зададен</span>'}
          ${cfg.hasFbCookie ? '<span class="pill pill-cyan">FB Cookie активен</span>' : ''}
        </span>
      </div>

      <details style="margin-top:12px"${!cfg.hasApifyToken && !cfg.hasFbCookie ? ' open' : ''}>
        <summary style="cursor:pointer;color:var(--muted);font-size:13.5px;padding:6px 0">
          ⚙️ Настройки за Facebook (Apify API ключ / FB Cookie / 1-клик бутон за браузър)
        </summary>
        <div class="form-grid" style="margin-top:10px">
          <label class="field">
            <span>Apify API Token (препоръчано за 100% автоматично сваляне от сървъра)</span>
            <input id="fb-apify-token" type="password" placeholder="${cfg.hasApifyToken ? 'Вече има записан токен (остави празно или въведи нов)' : 'apify_api_...'}" autocomplete="off">
            <span class="hint" style="margin-top:4px">Безплатна регистрация в <a href="https://console.apify.com/settings/integrations" target="_blank" rel="noopener">console.apify.com ↗</a> (ползва актьор <code>apify/facebook-groups-scraper</code>).</span>
          </label>
          <label class="field">
            <span>Facebook Cookie (по избор — за директно четене без Apify)</span>
            <input id="fb-cookie-input" type="password" placeholder="${cfg.hasFbCookie ? 'Вече има записан cookie' : 'c_user=...; xs=...'}" autocomplete="off">
            <span class="hint" style="margin-top:4px">Ако нямаш Apify ключ, можеш да поставиш Cookie от браузъра си или да ползваш 1-клик бутона долу.</span>
          </label>
          <label class="field" style="flex-direction:row;align-items:center;gap:8px">
            <input type="checkbox" id="fb-auto-approve" ${cfg.autoApprove ? 'checked' : ''}>
            <span>Автоматично одобряване на сигнали с висока увереност (без ръчен преглед)</span>
          </label>
          <label class="field">
            <span>Минимална увереност за авто-одобрение (0.1 – 1)</span>
            <input id="fb-auto-approve-min" type="number" min="0.1" max="1" step="0.05" value="${Number(cfg.autoApproveMin ?? 0.9)}">
            <span class="hint" style="margin-top:4px">0.9 = пускаме само сигналите, в които AI-ят е почти сигурен. Под прага остават за твоя преглед.</span>
          </label>
          <label class="field" style="flex-direction:row;align-items:center;gap:8px">
            <input type="checkbox" id="fb-comments-enabled" ${cfg.commentsEnabled === false ? '' : 'checked'}>
            <span>Да чете и коментарите под постовете (повече сигнали, малко по-бавно)</span>
          </label>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;align-items:center">
          <button class="btn btn-sm btn-ok" id="fb-save-settings">💾 Запази настройките</button>
          <a class="btn btn-sm" href="${bookmarkletHref}" onclick="event.preventDefault();toast('Плъзни този бутон в лентата с отметки (Bookmarks Bar) на браузъра си и го натисни, докато си във Facebook групата!','warn')" style="cursor:grab;border-color:rgba(6,182,212,.5)">📌 Прати от FB група → SmartPrice (плъзни в Отметки)</a>
          <button class="btn btn-sm btn-ghost" id="fb-copy-collector">📋 Копирай скрипт за браузър (F12)</button>
        </div>
      </details>
    </div>

    <div id="fb-job-status">${runningJob ? renderFbJobCard(runningJob) : jobs[0] ? renderFbJobCard(jobs[0]) : ''}</div>

    <div class="card" style="margin-top:14px">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <span>🧾 Опашка за преглед и одобрение</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm ${fbReceiptsFilter === 'pending' ? 'btn-primary' : 'btn-ghost'}" data-fb-tab="pending">⏳ Чакащи (${num(counts.pending)})</button>
          <button class="btn btn-sm ${fbReceiptsFilter === 'approved' ? 'btn-primary' : 'btn-ghost'}" data-fb-tab="approved">✅ Одобрени (${num(counts.approved)})</button>
          <button class="btn btn-sm ${fbReceiptsFilter === 'rejected' ? 'btn-primary' : 'btn-ghost'}" data-fb-tab="rejected">✕ Отхвърлени (${num(counts.rejected)})</button>
          <button class="btn btn-sm ${fbReceiptsFilter === 'not_receipt' ? 'btn-primary' : 'btn-ghost'}" data-fb-tab="not_receipt">🖼 Без бележка (${num(counts.not_receipt)})</button>
          <button class="btn btn-sm ${fbReceiptsFilter === 'all' ? 'btn-primary' : 'btn-ghost'}" data-fb-tab="all">Всички</button>
          <button class="btn btn-sm ${fbReceiptsPolarity === 'red' ? 'btn-primary' : 'btn-ghost'}" data-fb-pol="red">🔴 Червени флагове</button>
          <button class="btn btn-sm ${fbReceiptsPolarity === 'green' ? 'btn-primary' : 'btn-ghost'}" data-fb-pol="green">🟢 Топ находки</button>
          <button class="btn btn-sm ${fbFlaggedOnly ? 'btn-primary' : 'btn-ghost'}" id="fb-flag-filter">⚠️ С предупреждения${flaggedCount ? ` (${flaggedCount})` : ''}</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">
        <span class="hint" style="margin:0">🔎 Търси в бележките:</span>
        <input id="fb-search" value="${esc(fbReceiptsQuery)}" placeholder="касова бележка, промоция…" style="max-width:260px">
        <button class="btn btn-sm" id="fb-search-go">Търси</button>
        ${
          fbReceiptsQuery
            ? `<button class="btn btn-sm btn-ghost" id="fb-search-clear">✕ Изчисти търсенето</button>
               <span class="hint" style="margin:0">Филтър: „${esc(fbReceiptsQuery)}“</span>`
            : ''
        }
        <span class="hint" style="margin:0">Тема:</span>
        <button class="btn btn-sm ${fbReceiptsTopic === '' ? 'btn-primary' : 'btn-ghost'}" data-fb-topic="">Всички теми</button>
        ${
          (topicsEnabled.length ? topicsEnabled : Object.keys(FB_TOPIC_TITLES))
            .map(
              (k) =>
                `<button class="btn btn-sm ${fbReceiptsTopic === k ? 'btn-primary' : 'btn-ghost'}" data-fb-topic="${esc(k)}">${FB_TOPIC_TITLES[k] || esc(k)}</button>`
            )
            .join('')
        }
      </div>

      ${
        fbReceiptsFilter === 'pending' && items.length > 0
          ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:center">
               <button class="btn btn-ok" id="fb-approve-sel">✅ Одобри избраните (<span id="fb-sel-cnt">${fbReceiptsSelected.size}</span>)</button>
               <button class="btn btn-primary" id="fb-approve-all">✅ Одобри всички чакащи (${num(counts.pending)})</button>
               <button class="btn btn-danger" id="fb-reject-sel">✕ Отхвърли избраните</button>
               <button class="btn btn-ghost" id="fb-sel-all">Избери всички</button>
               <button class="btn btn-ghost" id="fb-sel-none">Изчисти</button>
             </div>`
          : ''
      }

      <div style="margin-top:12px">
        ${
          items.length
            ? items
                .filter((it) => !fbReceiptsPolarity || it.polarity === fbReceiptsPolarity)
                .filter((it) => !fbFlaggedOnly || it.flagged)
                .map((it) => renderFbQueueItemCard(it))
                .join('')
            : `<div class="empty" style="padding:28px 12px">${fbReceiptsPolarity || fbFlaggedOnly || fbReceiptsTopic ? 'Няма записи с този филтър — натисни „Всички теми“ и „Всички“ (или махни „Червени/Топ находки/С предупреждения“), за да видиш всичко.' : 'Няма записи в този списък. Пусни сваляне от групата горе или подай пост със снимка на бележка.'}</div>`
        }
      </div>
    </div>`;

  /* -------------------------------------------------- събития */

  document.querySelectorAll('[data-fb-tab]').forEach((btn) => {
    btn.onclick = () => {
      fbReceiptsFilter = btn.dataset.fbTab;
      fbReceiptsSelected = new Set();
      render('fb_receipts', true);
    };
  });

  document.querySelectorAll('[data-fb-topic]').forEach((btn) => {
    btn.onclick = () => {
      fbReceiptsTopic = btn.dataset.fbTopic || '';
      fbReceiptsSelected = new Set();
      render('fb_receipts', true);
    };
  });

  const flagFilter = document.getElementById('fb-flag-filter');
  if (flagFilter) {
    flagFilter.onclick = () => {
      fbFlaggedOnly = !fbFlaggedOnly;
      render('fb_receipts', true);
    };
  }

  const saveCostBtn = document.getElementById('fb-save-cost');
  if (saveCostBtn) {
    saveCostBtn.onclick = async () => {
      const limitUsd = Number(document.getElementById('fb-daily-limit').value);
      try {
        await api('/fb-receipts/cost', { method: 'POST', body: JSON.stringify({ limitUsd }) });
        toast('Дневният лимит е запазен: $' + limitUsd.toFixed(2), 'ok');
        render('fb_receipts', true);
      } catch (e) {
        toast(e.message, 'err');
      }
    };
  }

  const saveTopicsBtn = document.getElementById('fb-save-topics');
  if (saveTopicsBtn) {
    saveTopicsBtn.onclick = async () => {
      const keys = [...document.querySelectorAll('.fb-topic-key:checked')].map((el) => el.value);
      try {
        await api('/fb-receipts/topics', { method: 'POST', body: JSON.stringify({ keys }) });
        toast('Темите са запазени.', 'ok');
        render('fb_receipts', true);
      } catch (e) {
        toast(e.message, 'err');
      }
    };
  }

  // 🔎 Ключови думи, въведени от човека (пише ги сам).
  const saveKeywordsBtn = document.getElementById('fb-save-keywords');
  if (saveKeywordsBtn) {
    saveKeywordsBtn.onclick = async () => {
      const raw = (document.getElementById('fb-keywords') || {}).value || '';
      const keywords = raw
        .split(/[,\n;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      try {
        const r = await api('/fb-receipts/keywords', { method: 'POST', body: JSON.stringify({ keywords }) });
        toast(`Записани думи: ${(r.keywords || []).join(', ') || '—'}`, 'ok');
        render('fb_receipts', true);
      } catch (e) {
        toast(e.message, 'err');
      }
    };
  }

  // 🔎 „Търси „касова бележка“ в групата“ — отваря търсенето във Facebook.
  document.querySelectorAll('[data-fb-search]').forEach((b) => {
    b.onclick = () => openFbGroupSearch(b.dataset.fbSearch);
  });

  // 🔎 Търсене в самите бележки (заглавие, описание, място, търговец, текст от поста).
  const searchEl = document.getElementById('fb-search');
  const searchGo = document.getElementById('fb-search-go');
  const applySearch = () => {
    fbReceiptsQuery = searchEl ? searchEl.value.trim() : '';
    render('fb_receipts', true);
  };
  if (searchEl) {
    searchEl.onkeydown = (e) => {
      if (e.key === 'Enter') applySearch();
    };
  }
  if (searchGo) searchGo.onclick = applySearch;
  const searchClear = document.getElementById('fb-search-clear');
  if (searchClear) {
    searchClear.onclick = () => {
      fbReceiptsQuery = '';
      render('fb_receipts', true);
    };
  }
  const topicsAllBtn = document.getElementById('fb-topics-all');
  if (topicsAllBtn) {
    topicsAllBtn.onclick = () => {
      document.querySelectorAll('.fb-topic-key').forEach((el) => {
        el.checked = true;
      });
      toast('Избрани са всички теми — натисни „Запази темите“.', 'ok');
    };
  }

  document.querySelectorAll('[data-fb-pol]').forEach((btn) => {
    btn.onclick = () => {
      const val = btn.dataset.fbPol || '';
      // Включва/изключва филтъра по полярност (червени флагове / топ находки).
      fbReceiptsPolarity = fbReceiptsPolarity === val ? '' : val;
      render('fb_receipts', true);
    };
  });

  $('#fb-save-settings')?.addEventListener('click', async () => {
    const apifyToken = $('#fb-apify-token').value.trim();
    const fbCookie = $('#fb-cookie-input').value.trim();
    const body = {
      autoApprove: Boolean($('#fb-auto-approve')?.checked),
      autoApproveMin: Number($('#fb-auto-approve-min')?.value || 0.9),
      commentsEnabled: Boolean($('#fb-comments-enabled')?.checked),
    };
    if (apifyToken) body.apifyToken = apifyToken;
    if (fbCookie) body.fbCookie = fbCookie;
    try {
      await api('/fb-receipts/settings', { method: 'POST', body });
      toast('Настройките за Facebook са запазени');
      render('fb_receipts', true);
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  $('#fb-copy-collector')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(collectorScript);
      toast('Скриптът е копиран! Отвори FB групата, натисни F12 → Console, постави го и натисни Enter.');
    } catch {
      prompt('Копирай този ред и го пусни в Console (F12) върху отворената Facebook група:', collectorScript);
    }
  });

  $('#fb-run-btn').onclick = async () => {
    const groupUrl = $('#fb-group-url').value.trim();
    const count = Number($('#fb-count').value) || 10;
    const defaultCity = $('#fb-city').value.trim() || 'София';
    if (!groupUrl) return toast('Въведи адрес на Facebook група', 'warn');

    fbReceiptsLastGroupUrl = groupUrl;
    fbReceiptsLastCount = count;
    fbReceiptsLastCity = defaultCity;

    const btn = $('#fb-run-btn');
    btn.disabled = true;
    btn.textContent = 'Свалям и разчитам…';
    try {
      await api('/fb-receipts/jobs', {
        method: 'POST',
        body: { groupUrl, count, defaultCity },
      });
      toast('Задачата за сваляне на бележки стартира');
      await render('fb_receipts', true);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = '▶ Свали и разчети бележките';
    }
  };

  $('#fb-manual-btn').onclick = () => openManualFbReceiptModal();

  // Чекбоксове за масов избор
  document.querySelectorAll('[data-fb-check]').forEach((cb) => {
    cb.onchange = () => {
      const id = String(cb.dataset.fbCheck);
      if (cb.checked) fbReceiptsSelected.add(id);
      else fbReceiptsSelected.delete(id);
      const cnt = $('#fb-sel-cnt');
      if (cnt) cnt.textContent = String(fbReceiptsSelected.size);
    };
  });

  $('#fb-sel-all')?.addEventListener('click', () => {
    document.querySelectorAll('[data-fb-check]').forEach((cb) => {
      cb.checked = true;
      fbReceiptsSelected.add(String(cb.dataset.fbCheck));
    });
    const cnt = $('#fb-sel-cnt');
    if (cnt) cnt.textContent = String(fbReceiptsSelected.size);
  });

  $('#fb-sel-none')?.addEventListener('click', () => {
    fbReceiptsSelected = new Set();
    document.querySelectorAll('[data-fb-check]').forEach((cb) => {
      cb.checked = false;
    });
    const cnt = $('#fb-sel-cnt');
    if (cnt) cnt.textContent = '0';
  });

  $('#fb-approve-sel')?.addEventListener('click', async () => {
    if (!fbReceiptsSelected.size) return toast('Избери поне една бележка с чекбокса', 'warn');
    try {
      const res = await api('/fb-receipts/queue/approve-bulk', {
        method: 'POST',
        body: { ids: [...fbReceiptsSelected].map(Number) },
      });
      toast(`Одобрени и публикувани: ${res.approved}`);
      fbReceiptsSelected = new Set();
      render('fb_receipts', true);
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  $('#fb-approve-all')?.addEventListener('click', () => {
    confirmAction({
      title: 'Одобряване на всички чакащи бележки',
      message: `Сигурен ли си, че искаш да публикуваш всички ${num(counts.pending)} чакащи бележки?`,
      details: [
        'Всяка бележка ще бъде публикувана под профила „SmartPrice Редакция“ с разчетените артикули и текст.',
      ],
      confirmLabel: 'Публикувай всички',
      danger: false,
      onConfirm: async () => {
        const res = await api('/fb-receipts/queue/approve-bulk', {
          method: 'POST',
          body: { allPending: true },
        });
        toast(`Публикувани: ${res.approved}`);
        closeModal();
        render('fb_receipts', true);
      },
    });
  });

  $('#fb-reject-sel')?.addEventListener('click', async () => {
    if (!fbReceiptsSelected.size) return toast('Избери какво да отхвърлиш', 'warn');
    try {
      await api('/fb-receipts/queue/reject', {
        method: 'POST',
        body: { ids: [...fbReceiptsSelected].map(Number) },
      });
      toast('Избраните записи са отхвърлени');
      fbReceiptsSelected = new Set();
      render('fb_receipts', true);
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  // Единични бутони: Одобри, Редактирай и публикувай, Отхвърли
  document.querySelectorAll('[data-fb-approve]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.fbApprove;
      b.disabled = true;
      b.textContent = 'Публикувам…';
      try {
        await api(`/fb-receipts/queue/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} });
        toast('Бележката е одобрена и публикувана в SmartPrice!');
        render('fb_receipts', true);
      } catch (e) {
        toast(e.message, 'error');
        b.disabled = false;
        b.textContent = '✅ Одобри и публикувай';
      }
    };
  });

  document.querySelectorAll('[data-fb-edit]').forEach((b) => {
    b.onclick = () => {
      const item = items.find((x) => String(x.id) === String(b.dataset.fbEdit));
      if (item) openEditFbReceiptModal(item);
    };
  });

  document.querySelectorAll('[data-fb-reject]').forEach((b) => {
    b.onclick = async () => {
      const id = Number(b.dataset.fbReject);
      b.disabled = true;
      try {
        await api('/fb-receipts/queue/reject', { method: 'POST', body: { ids: [id] } });
        toast('Отхвърлено');
        render('fb_receipts', true);
      } catch (e) {
        toast(e.message, 'error');
        b.disabled = false;
      }
    };
  });

  // ↩︎ Връщане на отхвърлена бележка обратно в опашката (отхвърлена по грешка).
  document.querySelectorAll('[data-fb-unreject]').forEach((b) => {
    b.onclick = async () => {
      const id = Number(b.dataset.fbUnreject);
      b.disabled = true;
      b.textContent = 'Връщам…';
      try {
        await api('/fb-receipts/queue/unreject', { method: 'POST', body: { ids: [id] } });
        toast('Върнах я в опашката — виж таб „🖼 Без бележка“');
        render('fb_receipts', true);
      } catch (e) {
        toast(e.message, 'error');
        b.disabled = false;
        b.textContent = '↩︎ Върни в опашката';
      }
    };
  });

  // Ако има вървяща задача — следим я на всеки 2.5 сек
  if (runningJob) {
    fbReceiptsJobPoll = setInterval(async () => {
      if (state.page !== 'fb_receipts') return stopFbReceiptsPoll();
      try {
        const res = await api(`/fb-receipts/jobs/${runningJob.id}`);
        const j = res.job;
        const jobBox = $('#fb-job-status');
        if (jobBox && j) jobBox.innerHTML = renderFbJobCard(j);
        if (!j || j.status !== 'running') {
          stopFbReceiptsPoll();
          render('fb_receipts', true);
        }
      } catch {
        stopFbReceiptsPoll();
      }
    }, 2500);
  }

  const discoverBtn = document.getElementById('fb-discover-btn');
  if (discoverBtn) {
    discoverBtn.onclick = async () => {
      const st = document.getElementById('fb-discover-status');
      discoverBtn.disabled = true;
      if (st) st.textContent = 'Стартирам търсене в Apify…';
      try {
        const res = await api('/fb-receipts/groups/discover', { method: 'POST', body: JSON.stringify({}) });
        if (!res.started) {
          toast(res.reason || 'Вече върви търсене — изчакай.', 'err');
        } else {
          if (st) st.textContent = 'Търся в Apify… (1–3 минути). Новите групи се появяват тук, докато върви.';
          let tries = 0;
          while (tries < 45) {
            tries += 1;
            await new Promise((resolve) => setTimeout(resolve, 8000));
            await loadFbCandidates();
            const st2 = await api('/fb-receipts/groups/discover/status');
            if (st2 && st2.running === false) {
              const last = st2.last || {};
              if (last.ok === false) {
                toast(last.reason || 'Търсенето не успя.', 'err');
                if (st) st.textContent = 'Грешка: ' + (last.reason || 'неизвестна');
              } else {
                toast('Открити ' + Number(last.found || 0) + ' групи — нови за преглед: ' + Number(last.added || 0), 'ok');
                if (st) {
                  st.textContent = 'претърсени ' + ((last.queries || []).length) + ' заявки · нови ' + Number(last.added || 0) +
                    ' · познати ' + Number(last.known || 0) + ' · затворени ' + Number(last.skippedPrivate || 0) +
                    (last.usd ? ' · $' + Number(last.usd).toFixed(3) : '');
                }
              }
              break;
            }
          }
        }
      } catch (e) {
        toast(e.message, 'err');
        if (st) st.textContent = 'Грешка: ' + e.message;
      } finally {
        discoverBtn.disabled = false;
        await loadFbCandidates();
      }
    };
  }
  const isFull = !state.admin || state.admin.role === 'admin';
  if (isFull) {
    void loadFbCandidates();
    void loadPlans(false);
  } else {
    const a = document.getElementById('fb-cand-list');
    if (a) a.innerHTML = '<div class="hint" style="margin:0">Откриването на нови групи е само за главен админ.</div>';
    const b = document.getElementById('fb-plan-box');
    if (b) b.innerHTML = '<div class="hint" style="margin:0">Графикът на обиколките е само за главен админ.</div>';
  }
}

function renderFbJobCard(j) {
  const running = j.status === 'running';
  return `
    <div class="card" style="border-color:${running ? 'rgba(6,182,212,.55)' : j.status === 'failed' ? 'rgba(244,63,94,.45)' : 'rgba(34,197,94,.45)'}">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <span>
          ${running ? '<span class="spinner"></span> Върви сваляне' : j.status === 'done' ? '✅ Последна задача' : '⚠️ Задачата спря'}
          · <span class="mono" style="font-size:13px">${esc(j.group_url)}</span>
          ${j.strategy ? `<span class="pill pill-dim">режим: ${esc(j.strategy)}</span>` : ''}
        </span>
        <span class="hint" style="margin:0">${ago(j.created_at)}</span>
      </div>
      <div class="hint" style="margin-top:6px">
        Открити постове със снимки: <strong>${num(j.discovered)}</strong> ·
        Разчетени касови бележки: <strong>${num(j.receipts_found)}</strong> ·
        Пропуснати (без бон / дубликати): <strong>${num(j.skipped)}</strong> ·
        Грешки: <strong>${num(j.failed)}</strong>
        ${j.error ? `<br><span style="color:#FB7185">${esc(j.error)}</span>` : ''}
      </div>
      ${
        Array.isArray(j.log) && j.log.length
          ? `<details style="margin-top:8px"${running ? ' open' : ''}>
               <summary style="cursor:pointer;color:var(--muted);font-size:12.5px">Дневник на задачата (${j.log.length})</summary>
               <pre style="max-height:170px;overflow:auto;background:rgba(148,163,184,.08);border-radius:10px;padding:10px;font-size:12px;line-height:1.55;margin:6px 0 0">${esc(j.log.join('\n'))}</pre>
             </details>`
          : ''
      }
    </div>`;
}

function renderFbQueueItemCard(it) {
  const receiptItems = Array.isArray(it.items) ? it.items : [];
  const isGreen = it.polarity === 'green';
  const imgUrl = it.local_image_url || it.original_image_url;

  return `
    <div class="card" style="background:var(--card-2,rgba(148,163,184,.05));margin-bottom:12px;border-color:${
      it.status === 'approved'
        ? 'rgba(34,197,94,.4)'
        : it.status === 'pending'
          ? 'rgba(251,191,36,.35)'
          : 'rgba(148,163,184,.18)'
    }">
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div style="display:flex;align-items:flex-start;gap:10px">
          ${
            it.status === 'pending'
              ? `<input type="checkbox" style="width:18px;height:18px;margin-top:4px" data-fb-check="${esc(it.id)}"${
                  fbReceiptsSelected.has(String(it.id)) ? ' checked' : ''
                }>`
              : ''
          }
          <a href="${esc(imgUrl)}" target="_blank" rel="noopener" title="Отвори снимката на касовата бележка в пълен размер">
            <img src="${esc(imgUrl)}" loading="lazy" style="width:130px;height:170px;object-fit:cover;border-radius:10px;border:1px solid rgba(148,163,184,.25)">
          </a>
        </div>

        <div style="flex:1;min-width:280px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
            <div>
              <span class="pill ${isGreen ? 'pill-green' : 'pill-red'}">${isGreen ? '🟢 Находка / Оферта' : '🔴 Червен флаг / Сигнал'}</span>
              <span class="pill pill-dim">${esc(SCRAPE_CAT_LABELS[it.category] || it.category)}</span>
              ${
                it.flagged
                  ? `<span class="pill pill-gold">⚠️ Провери: ${esc((it.flags || []).join('; ')).slice(0, 120)}</span>`
                  : ''
              }
              ${
                it.topic && it.topic !== 'deals'
                  ? `<span class="pill pill-cyan">${FB_TOPIC_TITLES[it.topic] || esc(it.topic)}</span>`
                  : ''
              }
              <span class="pill pill-cyan">📍 ${esc(it.city || 'София')} · ${esc(it.place_name || it.merchant_name)}</span>
              ${
                it.status === 'approved'
                  ? `<span class="pill pill-green">Публикувано ${it.post_code ? `(#${esc(it.post_code)})` : ''}</span>`
                  : it.status === 'rejected'
                    ? '<span class="pill pill-red">Отхвърлено</span>'
                    : it.status === 'not_receipt'
                      ? `<span class="pill pill-dim">Не е бележка: ${esc(it.skip_reason || '')}</span>`
                      : '<span class="pill pill-gold">Чака одобрение</span>'
              }
            </div>
            <div style="font-size:18px;font-weight:800;color:#38BDF8">
              ${money(it.total_amount)}
              ${
                it.original_currency === 'BGN' && it.original_amount
                  ? `<span class="hint" style="font-size:12px;font-weight:500">(${Number(it.original_amount).toFixed(2)} лв. на бона)</span>`
                  : ''
              }
            </div>
          </div>

          <div style="font-weight:800;font-size:15.5px;margin-top:8px">${esc(it.title)}</div>
          <div class="hint" style="white-space:pre-wrap;margin:4px 0 8px;color:#E2E8F0">${esc(it.description)}</div>

          ${
            it.fb_post_text
              ? `<div style="background:rgba(15,23,42,.55);border-left:3px solid #38BDF8;padding:8px 12px;border-radius:6px;margin-bottom:8px;font-size:12.5px">
                   <div class="dim" style="margin-bottom:2px">💬 Оригинален текст от Facebook поста ${it.fb_author_name ? `(${esc(it.fb_author_name)})` : ''}:</div>
                   <div style="white-space:pre-wrap">${esc(it.fb_post_text.slice(0, 600))}${it.fb_post_text.length > 600 ? '…' : ''}</div>
                 </div>`
              : ''
          }

          <div class="hint" style="margin-bottom:8px">
            🧾 <strong>Търговец от бона:</strong> ${esc(it.merchant_name || '—')}
            ${it.merchant_tax_id ? ` · <strong>ЕИК:</strong> ${esc(it.merchant_tax_id)}` : ''}
            ${it.receipt_date ? ` · <strong>Дата:</strong> ${esc(it.receipt_date)} ${esc(it.receipt_time || '')}` : ''}
            · <strong>Сигурност на OCR:</strong> ${Math.round((Number(it.confidence) || 0) * 100)}%
            ${it.fb_post_url ? ` · <a href="${esc(it.fb_post_url)}" target="_blank" rel="noopener">Отвори FB поста ↗</a>` : ''}
          </div>

          ${
            receiptItems.length
              ? `<div style="background:rgba(15,23,42,.45);border:1px solid rgba(148,163,184,.16);border-radius:8px;padding:8px 10px;margin-bottom:10px">
                   <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px">Разпознати артикули от касовата бележка (${receiptItems.length}):</div>
                   <table style="font-size:12.5px">
                     <thead><tr><th>Артикул</th><th>К-во</th><th>Ед. цена</th><th>Общо</th><th>Бележка</th></tr></thead>
                     <tbody>
                       ${receiptItems
                         .map(
                           (line) => `<tr>
                         <td><strong>${esc(line.name)}</strong></td>
                         <td>${Number(line.quantity || 1)}</td>
                         <td>${money(line.unitPrice)}</td>
                         <td><strong>${money(line.totalPrice)}</strong></td>
                         <td class="dim">${esc(line.highlightReason || '—')}</td>
                       </tr>`
                         )
                         .join('')}
                     </tbody>
                   </table>
                 </div>`
              : '<div class="hint" style="margin-bottom:8px">Няма разбити отделни редове — разчетена е общата сума.</div>'
          }

          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${
              it.status !== 'approved'
                ? `<button class="btn btn-sm btn-ok" data-fb-approve="${esc(it.id)}">✅ Одобри и публикувай</button>
                   <button class="btn btn-sm btn-primary" data-fb-edit="${esc(it.id)}">✏️ Редактирай и публикувай</button>`
                : ''
            }
            ${
              it.status === 'pending' || it.status === 'not_receipt'
                ? `<button class="btn btn-sm btn-danger" data-fb-reject="${esc(it.id)}">✕ Отхвърли</button>`
                : ''
            }
            ${
              // Отхвърлена по грешка? Досега нямаше как да се върне — затова тук
              // има „Върни в опашката“ (връща я в „Без бележка“ за нов преглед).
              it.status === 'rejected'
                ? `<button class="btn btn-sm btn-ghost" data-fb-unreject="${esc(it.id)}">↩︎ Върни в опашката</button>`
                : ''
            }
          </div>
        </div>
      </div>
    </div>`;
}

/**
 * 🔎 Отваря търсенето в групата за дадена дума.
 *
 * Защо: търсенето във Facebook групата (напр. „касова бележка“) връща само
 * постовете с тази дума — там се пуска бутонът „📌 Прати от FB група“ и влизат
 * точно те. Ако групата не е попълнена, отваряме общото търсене във Facebook.
 */
function openFbGroupSearch(keyword) {
  const el = document.getElementById('fb-group-url');
  const raw = String((el && el.value) || fbReceiptsLastGroupUrl || '');
  const m = raw.match(/groups\/(\d+)/);
  const q = encodeURIComponent(keyword);
  const url = m
    ? `https://www.facebook.com/groups/${m[1]}/search/?q=${q}`
    : `https://www.facebook.com/search/posts?q=${q}`;
  window.open(url, '_blank', 'noopener');
}

/** Прозорец за редакция на разчетената бележка преди нейното публикуване. */
function openEditFbReceiptModal(it) {
  const receiptItems = Array.isArray(it.items) ? it.items : [];
  const itemsText = receiptItems
    .map((l) => `${l.name} | ${l.quantity ?? 1} | ${Number(l.unitPrice ?? 0).toFixed(2)} | ${Number(l.totalPrice ?? 0).toFixed(2)}${l.highlightReason ? ` | ${l.highlightReason}` : ''}`)
    .join('\n');

  const html = `
    <div class="form-grid">
      <label class="field full"><span>Заглавие на публикацията</span>
        <input id="fbe-title" value="${esc(it.title || '')}"></label>
      <label class="field full"><span>Описание (текст от поста + обобщение)</span>
        <textarea id="fbe-desc" rows="4">${esc(it.description || '')}</textarea></label>
      <label class="field"><span>Тип (Полярност)</span>
        <select id="fbe-pol">
          <option value="red"${it.polarity === 'red' ? ' selected' : ''}>🔴 Червен флаг / Висока цена</option>
          <option value="green"${it.polarity === 'green' ? ' selected' : ''}>🟢 Добра оферта / Находка</option>
        </select></label>
      <label class="field"><span>Категория</span>
        <select id="fbe-cat">
          ${Object.entries(SCRAPE_CAT_LABELS)
            .map(([k, v]) => `<option value="${k}"${it.category === k ? ' selected' : ''}>${esc(v)}</option>`)
            .join('')}
        </select></label>
      <label class="field"><span>Място / Заведение / Магазин</span>
        <input id="fbe-place" value="${esc(it.place_name || '')}"></label>
      <label class="field"><span>Град</span>
        <input id="fbe-city" value="${esc(it.city || 'София')}"></label>
      <label class="field"><span>Обща сума (€)</span>
        <input id="fbe-total" type="number" step="0.01" min="0.01" value="${Number(it.total_amount || 0).toFixed(2)}"></label>
      <label class="field"><span>Търговец по касов бон</span>
        <input id="fbe-merchant" value="${esc(it.merchant_name || '')}"></label>
      <label class="field"><span>Дата на бона (DD.MM.YYYY)</span>
        <input id="fbe-date" value="${esc(it.receipt_date || '')}"></label>
      <label class="field"><span>Час (HH:MM)</span>
        <input id="fbe-time" value="${esc(it.receipt_time || '')}"></label>
      <label class="field full">
        <span>Артикули от касовата бележка (по един на ред: <code>Име | К-во | Ед. цена (€) | Общо (€) | Бележка</code>)</span>
        <textarea id="fbe-items" rows="6" class="mono" style="font-size:12.5px">${esc(itemsText)}</textarea>
      </label>
    </div>`;

  openModal(
    'Редакция и публикуване на касова бележка',
    html,
    [
      {
        id: 'fbe-save',
        label: '✅ Одобри и публикувай',
        cls: 'btn-ok',
        onClick: async () => {
          const parsedLines = ($('#fbe-items').value || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const parts = line.split('|').map((s) => s.trim());
              const name = parts[0] || '';
              const quantity = Number(parts[1]) || 1;
              const unitPrice = Number(parts[2]) || 0;
              const totalPrice = Number(parts[3]) || Number((quantity * unitPrice).toFixed(2));
              const highlightReason = parts[4] || null;
              return { name, quantity, unitPrice, totalPrice, highlightReason };
            })
            .filter((l) => l.name);

          const body = {
            title: $('#fbe-title').value.trim(),
            description: $('#fbe-desc').value.trim(),
            polarity: $('#fbe-pol').value,
            category: $('#fbe-cat').value,
            placeName: $('#fbe-place').value.trim(),
            city: $('#fbe-city').value.trim(),
            totalAmount: Number($('#fbe-total').value),
            merchantName: $('#fbe-merchant').value.trim(),
            receiptDate: $('#fbe-date').value.trim() || null,
            receiptTime: $('#fbe-time').value.trim() || null,
            items: parsedLines,
          };

          try {
            await api(`/fb-receipts/queue/${encodeURIComponent(it.id)}/approve`, {
              method: 'POST',
              body,
            });
            toast('Публикувано успешно!');
            closeModal();
            render('fb_receipts', true);
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      },
      { id: 'fbe-cancel', label: 'Отказ', cls: 'btn-ghost', onClick: closeModal },
    ],
    true
  );
}

/** Ръчно подаване на пост от Facebook (снимка на касова бележка + текст на поста) за AI разчитане. */
function openManualFbReceiptModal() {
  const html = `
    <div class="hint" style="margin-bottom:10px">
      Качи снимка на касова бележка от компютъра си (или постави линк към снимката от Facebook) и копирай текста на поста.
      AI Vision ще разчете всички артикули от касовата бележка и ще я постави в опашката за одобрение.
    </div>
    <div class="form-grid">
      <label class="field full"><span>Снимка на касовата бележка (избери файл или постави URL долу)</span>
        <input type="file" id="fbm-file" accept="image/jpeg,image/png,image/webp"></label>
      <label class="field full"><span>Или директен адрес (URL) на снимката</span>
        <input id="fbm-img-url" placeholder="https://scontent..."></label>
      <label class="field full"><span>Текст, с който е направен постът във Facebook</span>
        <textarea id="fbm-text" rows="4" placeholder="Постави тук текста на автора от Facebook групата…"></textarea></label>
      <label class="field"><span>Линк към поста / групата</span>
        <input id="fbm-post-url" value="${esc(fbReceiptsLastGroupUrl)}" placeholder="https://www.facebook.com/groups/3111975342346393"></label>
      <label class="field"><span>Град по подразбиране</span>
        <input id="fbm-city" value="${esc(fbReceiptsLastCity || 'София')}"></label>
    </div>`;

  openModal(
    '➕ Подай пост с касова бележка за AI разчитане',
    html,
    [
      {
        id: 'fbm-submit',
        label: '🤖 Разчети с AI и прати за одобрение',
        cls: 'btn-primary',
        onClick: async () => {
          const fileInput = $('#fbm-file');
          let imageUrl = $('#fbm-img-url').value.trim();
          const text = $('#fbm-text').value.trim();
          const postUrl = $('#fbm-post-url').value.trim() || fbReceiptsLastGroupUrl;
          const defaultCity = $('#fbm-city').value.trim() || 'София';

          if (fileInput?.files?.[0]) {
            imageUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error('Неуспешно четене на файла'));
              reader.readAsDataURL(fileInput.files[0]);
            });
          }

          if (!imageUrl) {
            return toast('Избери снимка на касова бележка или постави нейния адрес', 'warn');
          }

          const btn = $('#fbm-submit');
          btn.disabled = true;
          btn.textContent = 'Разчитам с AI…';
          try {
            const res = await api('/fb-receipts/ingest', {
              method: 'POST',
              body: {
                groupUrl: postUrl,
                defaultCity,
                posts: [{ postUrl, text, imageUrls: [imageUrl] }],
              },
            });
            closeModal();
            if (res.queued > 0) {
              fbReceiptsFilter = 'pending';
              toast('Касовата бележка е разчетена и чака твоето одобрение!');
            } else {
              toast('Снимката беше проверена (виж секция „Без бележка“ или „Чакащи“).', 'warn');
            }
            render('fb_receipts', true);
          } catch (e) {
            toast(e.message, 'error');
            btn.disabled = false;
            btn.textContent = '🤖 Разчети с AI и прати за одобрение';
          }
        },
      },
      { id: 'fbm-cancel', label: 'Отказ', cls: 'btn-ghost', onClick: closeModal },
    ],
    true
  );
}

const WIN_STATUS = {
  pending_data: ['Чака адрес от победителя', 'pill-gold'],
  ready_to_ship: ['Готово за изпращане', 'pill-cyan'],
  shipped: ['Изпратено', 'pill-green'],
  delivered: ['Доставено', 'pill-dim'],
  expired: ['Изтекло (не даде адрес)', 'pill-red'],
};

/**
 * Печалби и доставки.
 *
 * Тук се вижда кой какво е спечелил и има ли данни за куриера. Без този екран
 * наградата се губи: победителят я чака, а никой не знае къде да я прати.
 */
async function renderWins(box, force) {
  const status = (cache.winsFilter = force ? 'all' : cache.winsFilter || 'all');
  const data = await api(`/raffle-wins?status=${encodeURIComponent(status)}`);
  const items = data.items || [];

  box.innerHTML = `
    <div class="toolbar">
      <select class="grow" id="w-status">
        ${['all', 'pending_data', 'ready_to_ship', 'shipped', 'delivered', 'expired']
          .map((s) => `<option value="${s}"${s === status ? ' selected' : ''}>${s === 'all' ? 'Всички печалби' : esc(WIN_STATUS[s][0])}</option>`)
          .join('')}
      </select>
      <button class="btn" id="w-expire">Маркирай изтеклите срокове</button>
    </div>

    <div class="card">
      <div class="card-title">🏆 Спечелени награди (${num(items.length)})</div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Спечелена</th><th>Победител</th><th>Награда</th><th>Статус</th><th>Данни за доставка</th><th></th>
        </tr></thead>
        <tbody>
        ${
          items.length
            ? items
                .map((w) => {
                  const d = w.delivery || {};
                  const st = WIN_STATUS[w.status] || ['?', 'pill-dim'];
                  const hasData = Boolean(d.name || d.address);
                  return `<tr>
              <td class="mono dim">${w.wonAt ? new Date(w.wonAt).toLocaleString('bg-BG') : '—'}<div class="dim">${esc(w.raffleTitle || '')}</div></td>
              <td>${esc(w.winner.name)}<div class="dim">@${esc(w.winner.handle || '')} · ${esc(w.winner.email || '')}</div></td>
              <td>${esc(w.prizeTitle)}${w.sponsorName ? `<div class="dim">от ${esc(w.sponsorName)}</div>` : ''}</td>
              <td><span class="pill ${st[1]}">${esc(st[0])}</span>
                  ${w.trackingNote ? `<div class="dim">${esc(w.trackingNote)}</div>` : ''}</td>
              <td>${hasData
                  ? `${esc(d.name || '')}<div class="dim">${esc(d.phone || '')} · ${esc(d.city || '')}</div><div class="dim">${esc(d.address || '')}</div>${d.note ? `<div class="dim">${esc(d.note)}</div>` : ''}`
                  : '<span class="pill pill-gold">още няма адрес</span>'}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm" data-w-ship="${w.id}">Изпратено</button>
                <button class="btn btn-sm" data-w-done="${w.id}">Доставено</button>
                <button class="btn btn-sm btn-danger" data-w-next="${w.id}" title="Наградата отива при следващия в класирането">Дай на следващия</button>
              </td>
            </tr>`;
                })
                .join('')
            : '<tr><td colspan="6" class="empty">Още няма спечелени награди</td></tr>'
        }
        </tbody></table></div>
      <div class="hint" style="margin-top:10px">
        Победителят получава писмо веднага след печалбата. Ако не даде адрес в срока
        (вижда се в „Спечелена“), наградата може да отиде при следващия в класирането
        с бутона „Дай на следващия“.
      </div>
    </div>`;

  $('#w-status').onchange = (e) => {
    cache.winsFilter = e.target.value;
    render('wins', false);
  };

  $('#w-expire')?.addEventListener('click', async () => {
    const res = await api('/raffle-wins/expire', { method: 'POST' });
    toast(res.expired ? `Маркирани ${res.expired} изтекли` : 'Няма изтекли срокове');
    render('wins', true);
  });

  box.querySelectorAll('[data-w-ship]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const note = prompt('Номер на пратка / куриер (по избор):', '');
      if (note === null) return;
      await api(`/raffle-wins/${btn.dataset.wShip}/status`, {
        method: 'POST',
        body: { status: 'shipped', trackingNote: note || undefined },
      });
      toast('Отбелязано като изпратено');
      render('wins', true);
    });
  });

  box.querySelectorAll('[data-w-done]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/raffle-wins/${btn.dataset.wDone}/status`, {
        method: 'POST',
        body: { status: 'delivered' },
      });
      toast('Отбелязано като доставено');
      render('wins', true);
    });
  });

  box.querySelectorAll('[data-w-next]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Наградата да отиде при следващия в класирането?')) return;
      try {
        const res = await api(`/raffle-wins/${btn.dataset.wNext}/next-in-line`, { method: 'POST' });
        toast(`Наградата отива при ${res.next}`);
        render('wins', true);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  });
}

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

/**
 * Модераторът вижда само модерацията. Скриваме му секциите с настройки,
 * ключове, GDPR, екип и роли. Сървърът също пази правата си — това е само UI.
 */
function applyRoleUi() {
  const role = (state.admin && state.admin.role) || 'admin';
  const full = role === 'admin';
  const hiddenForModerator = ['users', 'raffles', 'demo', 'referrals', 'assistant', 'scraper', 'security', 'emails', 'audit'];
  document.querySelectorAll('.nav-item').forEach((b) => {
    const page = b.dataset.page || '';
    const hide = !full && hiddenForModerator.includes(page);
    b.hidden = hide;
  });
  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = full ? 'главен админ' : 'модератор';
    badge.className = 'pill ' + (full ? 'pill-green' : 'pill-gold');
    badge.hidden = false;
  }
}

/* ===== 🔐 2FA, екип и роли, GDPR (в секция „Сигурност“) ===== */
async function loadSecurityExtras() {
  const box = document.getElementById('sec-extra');
  if (!box) return;
  const role = (state.admin && state.admin.role) || 'admin';
  const full = role === 'admin';
  box.innerHTML = '<div class="card"><span class="spinner"></span></div>';
  try {
    const tf = await api('/2fa/status').catch(() => ({ enabled: false, pendingSetup: false }));
    const team = await api('/team').catch(() => ({ team: [], adminEmails: [] }));
    const members = (team.team || [])
      .map(
        (m) =>
          '<tr><td><strong>' + esc(m.name) + '</strong><div class="dim">' + esc(m.email) + '</div></td>' +
          '<td><span class="pill ' + (m.role === 'admin' ? 'pill-green' : 'pill-gold') + '">' + (m.role === 'admin' ? 'главен админ' : 'модератор') + '</span></td>' +
          '<td>' + (m.totp_enabled ? '<span class="pill pill-green">включена</span>' : '<span class="pill pill-dim">изключена</span>') + '</td>' +
          '<td class="dim nowrap">' + ago(m.last_login_at) + '</td>' +
          '<td class="actions">' + (m.role === 'moderator' ? '<button class="btn btn-sm btn-ghost" data-team-rm="' + esc(m.id) + '">махни правата</button>' : '') + '</td></tr>'
      )
      .join('');

    box.innerHTML =
      '<div class="card" style="margin-bottom:12px">' +
        '<div class="card-title">🔐 Двуфакторна защита (2FA)</div>' +
        '<div class="hint">Освен паролата се иска код от приложението (Google Authenticator, Authy, 1Password). ' +
          (tf.enabled ? '<span class="pill pill-green">включена</span>' : '<span class="pill pill-dim">изключена</span>') + '</div>' +
        (full
          ? tf.enabled
            ? '<div class="row" style="margin-top:10px"><input id="tfa-pass" type="password" placeholder="паролата ти" style="max-width:260px"><button class="btn btn-sm" id="tfa-off">Спри защитата</button></div>'
            : '<div class="row" style="margin-top:10px"><button class="btn btn-sm btn-ok" id="tfa-setup">Настрой двуфакторна защита</button><span class="dim" id="tfa-out"></span></div>' +
              '<div id="tfa-confirm" hidden style="margin-top:10px">' +
              '<div class="hint">Отвори приложението-автентикатор → „Добави“ → „Въведи ключ“ и напиши тайната по-горе (или отвори адреса). После въведи кода тук:</div>' +
              '<div class="row" style="margin-top:6px"><input id="tfa-code" inputmode="numeric" maxlength="10" placeholder="123456" style="max-width:140px"><button class="btn btn-sm btn-ok" id="tfa-on">Включи</button></div></div>'
          : '<div class="hint" style="margin-top:8px">Само главният админ може да променя 2FA.</div>') +
      '</div>' +

      '<div class="card" style="margin-bottom:12px">' +
        '<div class="card-title">👥 Екип и роли</div>' +
        '<div class="hint">Модераторът ползва само модерацията (ФБ Бележки, оферти, коментари, сигнали) — без настройки, ключове, GDPR и екип.</div>' +
        '<div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Човек</th><th>Роля</th><th>2FA</th><th>Последен вход</th><th></th></tr></thead><tbody>' +
          (members || '<tr><td colspan="5" class="dim">—</td></tr>') +
        '</tbody></table></div>' +
        (full
          ? '<div class="row" style="margin-top:10px"><input id="team-email" placeholder="имейл на регистриран потребител" style="max-width:300px">' +
            '<select id="team-role"><option value="moderator">модератор</option><option value="admin">главен админ</option></select>' +
            '<button class="btn btn-sm btn-ok" id="team-add">Дай права</button></div>'
          : '') +
      '</div>' +

      '<div class="card" style="margin-bottom:12px">' +
        '<div class="card-title">🔔 Push известия (Web Push / VAPID)</div>' +
        '<div class="hint">Известия до браузъра/телефона вместо имейл. Абонаменти: <strong id="push-devices">…</strong></div>' +
        '<div class="row" style="margin-top:10px">' +
          '<input id="push-title" placeholder="заглавие (по избор)" style="max-width:240px">' +
          '<input id="push-body" placeholder="текст (по избор)" style="max-width:320px">' +
          '<button class="btn btn-sm btn-ok" id="push-send">Изпрати тестово до всички</button>' +
        '</div>' +
        '<div class="hint" style="margin-top:8px">Публичен ключ: <span class="mono" id="push-key">…</span></div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card-title">🧹 GDPR: право на забравяне</div>' +
        '<div class="hint">Търси по имейл, @handle или име. Първо виждаш точно какво ще се изтрие.</div>' +
        (full
          ? '<div class="row" style="margin-top:8px"><input id="gdpr-q" placeholder="имейл / @handle / име" style="max-width:320px"><button class="btn btn-sm" id="gdpr-search">Търси</button></div><div id="gdpr-res" style="margin-top:10px"></div>'
          : '<div class="hint" style="margin-top:8px">Само главният админ има достъп до GDPR инструментите.</div>') +
      '</div>';

    const $e = (id) => document.getElementById(id);

    if ($e('tfa-setup'))
      $e('tfa-setup').onclick = async () => {
        try {
          const r = await api('/2fa/setup', { method: 'POST' });
          $e('tfa-out').innerHTML = 'тайна: <strong class="mono">' + esc(r.secret) + '</strong> · <a href="' + esc(r.uri) + '">отвори в приложението</a>';
          $e('tfa-confirm').hidden = false;
          toast('Тайната е готова — въведи я в приложението и напиши кода.', 'ok');
        } catch (e) {
          toast(e.message, 'err');
        }
      };

    if ($e('tfa-on'))
      $e('tfa-on').onclick = async () => {
        try {
          await api('/2fa/enable', { method: 'POST', body: { code: $e('tfa-code').value.trim() } });
          toast('Двуфакторната защита е включена. От следващия вход ще иска код.', 'ok');
          void loadSecurityExtras();
        } catch (e) {
          toast(e.message, 'err');
        }
      };

    if ($e('tfa-off'))
      $e('tfa-off').onclick = async () => {
        try {
          await api('/2fa/disable', { method: 'POST', body: { password: $e('tfa-pass').value } });
          toast('Защитата е спряна.', 'ok');
          void loadSecurityExtras();
        } catch (e) {
          toast(e.message, 'err');
        }
      };

    if ($e('team-add'))
      $e('team-add').onclick = async () => {
        try {
          const r = await api('/team', { method: 'POST', body: { email: $e('team-email').value.trim(), role: $e('team-role').value } });
          toast('Правата са дадени на ' + (r.member && r.member.name ? r.member.name : '') + '.', 'ok');
          void loadSecurityExtras();
        } catch (e) {
          toast(e.message, 'err');
        }
      };

    box.querySelectorAll('[data-team-rm]').forEach((b) => {
      b.onclick = () =>
        confirmAction({
          title: 'Махни правата',
          message: 'Човекът остава с обикновен профил и губи достъп до панела.',
          confirmLabel: 'Махни',
          onConfirm: async () => {
            closeModal();
            try {
              await api('/team/' + b.dataset.teamRm, { method: 'DELETE' });
              toast('Правата са махнати.', 'ok');
              void loadSecurityExtras();
            } catch (e) {
              toast(e.message, 'err');
            }
          },
        });
    });

    // Push статистика + тестово известие
    (async () => {
      try {
        const st = await api('/push/stats');
        const el = $e('push-devices');
        if (el) el.textContent = Number(st.devices || 0) + ' устройства · ' + Number(st.users || 0) + ' души' + (st.last_ok ? ' · последно ' + ago(st.last_ok) : '');
        const k = $e('push-key');
        if (k) k.textContent = String(st.publicKey || '').slice(0, 24) + '…';
      } catch (e) {
        const el = $e('push-devices');
        if (el) el.textContent = 'грешка: ' + e.message;
      }
      const sb = $e('push-send');
      if (sb)
        sb.onclick = async () => {
          try {
            const body = {};
            if ($e('push-title').value.trim()) body.title = $e('push-title').value.trim();
            if ($e('push-body').value.trim()) body.body = $e('push-body').value.trim();
            const r = await api('/push/test-all', { method: 'POST', body });
            toast('Изпратено до ' + Number(r.sent || 0) + ' устройства' + (r.gone ? ' · ' + r.gone + ' мъртви премахнати' : '') + (r.failed ? ' · неуспешни ' + r.failed : ''), r.sent ? 'ok' : 'warn');
          } catch (e) {
            toast(e.message, 'err');
          }
        };
    })();

    if ($e('gdpr-search')) {
      const runSearch = async () => {
        const q = $e('gdpr-q').value.trim();
        if (q.length < 2) return toast('Напиши поне 2 букви.', 'warn');
        $e('gdpr-res').innerHTML = '<span class="spinner"></span>';
        try {
          const r = await api('/gdpr/search?q=' + encodeURIComponent(q));
          const users = r.users || [];
          $e('gdpr-res').innerHTML = users.length
            ? '<div class="table-wrap"><table><thead><tr><th>Човек</th><th>Град</th><th>Оферти</th><th>Състояние</th><th></th></tr></thead><tbody>' +
              users.map((u) =>
                '<tr><td><strong>' + esc(u.name) + '</strong><div class="dim">' + esc(u.email) + ' · ' + esc(u.handle) + '</div></td>' +
                '<td>' + esc(u.city) + '</td><td>' + Number(u.posts || 0) + '</td>' +
                '<td>' + (u.anonymized_at ? '<span class="pill pill-gold">обезличен</span>' : u.deleted ? '<span class="pill pill-red">изтрит</span>' : '<span class="pill pill-green">активен</span>') + '</td>' +
                '<td class="actions"><button class="btn btn-sm" data-gdpr-prev="' + esc(u.id) + '">Прегледай</button></td></tr>'
              ).join('') + '</tbody></table></div>'
            : '<div class="dim">Никой не е намерен.</div>';
          $e('gdpr-res').querySelectorAll('[data-gdpr-prev]').forEach((b) => {
            b.onclick = () => void loadGdprPreview(b.dataset.gdprPrev);
          });
        } catch (e) {
          $e('gdpr-res').innerHTML = '<div class="dim">Грешка: ' + esc(e.message) + '</div>';
        }
      };
      $e('gdpr-search').onclick = runSearch;
      $e('gdpr-q').addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') void runSearch();
      });
    }
  } catch (e) {
    box.innerHTML = '<div class="card"><div class="hint">Грешка: ' + esc(e.message) + '</div></div>';
  }
}

/** Преглед какво точно ще се изтрие + бутоните за обезличаване и пълно изтриване. */
async function loadGdprPreview(userId) {
  const res = document.getElementById('gdpr-res');
  if (!res) return;
  res.innerHTML = '<span class="spinner"></span>';
  try {
    const p = await api('/gdpr/preview/' + encodeURIComponent(userId));
    const c = p.counts || {};
    const rows = [
      ['Оферти (постове)', c.posts], ['Коментари', c.comments], ['Кас. бележки', c.receipts],
      ['Качени снимки', c.uploads], ['Ценови аларми', c.price_alerts], ['Реакции', c.reactions],
      ['Любими', c.bookmarks], ['„Помогна ми“', c.helped], ['Дарения', c.donations],
      ['Сигнали от него', c.reports], ['Покани', c.referrals],
    ];
    res.innerHTML =
      '<div class="card"><div class="card-title">👤 ' + esc(p.user.name) + ' · ' + esc(p.user.email) + '</div>' +
      '<div class="hint">' + esc(p.user.handle) + ' · ' + esc(p.user.city) + ' · регистрация: ' + ago(p.user.created_at) + '</div>' +
      '<div class="table-wrap" style="margin-top:8px"><table><tbody>' +
      rows.filter(([, v]) => Number(v) > 0).map(([k, v]) => '<tr><td>' + k + '</td><td><strong>' + Number(v) + '</strong></td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="row" style="margin-top:12px">' +
      '<button class="btn btn-sm btn-ok" id="gdpr-anon">🧹 Обезличи (офертите остават)</button>' +
      '<button class="btn btn-sm btn-danger-solid" id="gdpr-erase">🗑 Изтрий всичко</button>' +
      '</div>' +
      '<div class="hint" style="margin-top:8px">Обезличаването маха име, имейл, @handle и снимката, но офертите и цените остават (те са общностни данни). Пълното изтриване маха и съдържанието.</div></div>';

    document.getElementById('gdpr-anon').onclick = () =>
      confirmAction({
        title: 'Обезличаване по GDPR',
        message: 'Името, имейлът, @handle-ът и снимката се махат. Офертите и цените остават.',
        details: ['Оферти: ' + Number(c.posts || 0) + ' (остават)', 'Коментари: ' + Number(c.comments || 0) + ' (остават)', 'Ценови аларми: ' + Number(c.price_alerts || 0) + ' (изтриват се)'],
        confirmLabel: 'Обезличи',
        onConfirm: async () => {
          closeModal();
          try {
            await api('/gdpr/anonymize', { method: 'POST', body: { userId } });
            toast('Профилът е обезличен.', 'ok');
            res.innerHTML = '<div class="dim">Готово — профилът е обезличен.</div>';
          } catch (e) {
            toast(e.message, 'err');
          }
        },
      });

    document.getElementById('gdpr-erase').onclick = () =>
      confirmAction({
        title: 'Пълно изтриване по GDPR',
        message: 'Това НЕ може да се върне: махат се профилът и съдържанието на човека.',
        details: ['Оферти: ' + Number(c.posts || 0), 'Коментари: ' + Number(c.comments || 0), 'Качени снимки: ' + Number(c.uploads || 0), 'Кас. бележки: ' + Number(c.receipts || 0)],
        confirmLabel: 'Изтрий завинаги',
        onConfirm: async () => {
          closeModal();
          try {
            const r = await api('/gdpr/erase', { method: 'POST', body: { userId } });
            toast('Профилът и съдържанието са изтрити.' + (r.blocked && r.blocked.length ? ' (засегнати: ' + r.blocked.join(', ') + ')' : ''), 'ok');
            res.innerHTML = '<div class="dim">Готово — профилът е изтрит.</div>';
          } catch (e) {
            toast(e.message, 'err');
          }
        },
      });
  } catch (e) {
    res.innerHTML = '<div class="dim">Грешка: ' + esc(e.message) + '</div>';
  }
}

async function renderSecurity(box, force) {
  const f = (cache.securityFilter = force ? { onlyOpen: false } : cache.securityFilter || { onlyOpen: false });
  const data = await api(`/security?onlyOpen=${f.onlyOpen}&limit=50`);
  box.innerHTML = `
    <div id="sec-extra" style="margin-bottom:14px"></div>
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

  void loadSecurityExtras();
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


/* ==================================================== 🎬 СОЦИАЛНИ МРЕЖИ ===
 * Собствено меню за проучване на TikTok и Instagram.
 *
 * Защо е отделно от Скрапера: Скраперът пълни оферти в приложението, а тук
 * събираме РЕКЛАМНО разузнаване — кои видеа гърмят, кои са реклами, кои продават
 * продукт. Опциите не са записани тук, а идват от сървъра (`/social/info`), така
 * че като добавим нова опция в кода, тя веднага се появява в панела.
 */

const SOC_TABS = [
  ['new', '🚀 Ново сканиране'],
  ['items', '📊 Резултати'],
  ['ideas', '💡 Идеи за скриптове'],
  ['hist', '📜 История'],
  ['setup', '⚙️ Настройки'],
  ['auto', '🤖 Автоматизация'],
];
const SOC_PANES = {
  new: 'soc-pane-new',
  items: 'soc-pane-items',
  ideas: 'soc-pane-ideas',
  hist: 'soc-pane-hist',
  setup: 'soc-pane-setup',
  auto: 'soc-pane-auto',
};

let socTab = 'new';
let socInfo = null;
let socRunning = null; // таймерът за чакане
let socItemsFilter = { platform: '', run: '', q: '', minViews: 0, sort: 'views', onlyAds: false, onlyShop: false };
let socForm = { platform: 'tiktok', mode: 'hashtag', targets: '', advanced: false, options: {} };

function socTabsHtml() {
  return `<div class="sc-tabs">${SOC_TABS.map(
    ([id, label]) =>
      `<button type="button" class="sc-tab${socTab === id ? ' active' : ''}" data-soc-tab="${id}">${esc(label)}</button>`
  ).join('')}</div>`;
}

function socSwitchTab(name) {
  socTab = name;
  SOC_TABS.forEach(([id]) => {
    const pane = document.getElementById(SOC_PANES[id]);
    if (!pane) return;
    // ВАЖНО: `display = ''` НЕ стига — CSS-ът на .sc-pane е display:none, затова
    // панелът пак оставаше скрит и изглеждаше „нищо не работи“. Затова слагаме
    // и класа active, и явен display.
    const on = id === name;
    pane.style.display = on ? 'block' : 'none';
    pane.classList.toggle('active', on);
  });
  document.querySelectorAll('[data-soc-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.socTab === name);
  });
}

function socStopPoll() {
  if (socRunning) {
    clearTimeout(socRunning);
    socRunning = null;
  }
}

/** Кой режим/платформа са избрани в момента. */
function socPlatform() {
  return (socInfo?.platforms || []).find((p) => p.id === socForm.platform) || null;
}
function socMode() {
  const p = socPlatform();
  return (p?.modes || []).find((m) => m.id === socForm.mode) || p?.modes?.[0] || null;
}

/** Една опция → HTML. Панелът не знае кои опции има — сървърът ги праща. */
function socOptionHtml(o) {
  const val = socForm.options[o.key] !== undefined ? socForm.options[o.key] : o.def;
  const adv = o.advanced ? ' data-soc-adv="1"' : '';
  const help = o.help ? `<div class="hint">${esc(o.help)}</div>` : '';
  if (o.kind === 'checkbox') {
    return `<label class="soc-opt soc-opt-check"${adv}>
      <input type="checkbox" data-soc-opt="${esc(o.key)}" ${val ? 'checked' : ''} />
      <span><b>${esc(o.label)}</b>${o.actor ? ' <span class="pill pill-gold">платено</span>' : ''}</span>
    </label>${help}`;
  }
  if (o.kind === 'select') {
    return `<label class="field soc-opt"${adv}><span>${esc(o.label)}</span>
      <select data-soc-opt="${esc(o.key)}">${(o.options || [])
        .map((x) => `<option value="${esc(x.value)}" ${String(val) === x.value ? 'selected' : ''}>${esc(x.label)}</option>`)
        .join('')}</select>${help}</label>`;
  }
  if (o.kind === 'number') {
    return `<label class="field soc-opt"${adv}><span>${esc(o.label)}</span>
      <input type="number" data-soc-opt="${esc(o.key)}" value="${esc(String(val ?? 0))}"
        ${o.min !== undefined ? `min="${o.min}"` : ''} ${o.max !== undefined ? `max="${o.max}"` : ''} />
      ${help}</label>`;
  }
  return `<label class="field soc-opt"${adv}><span>${esc(o.label)}</span>
    <input type="text" data-soc-opt="${esc(o.key)}" value="${esc(String(val ?? ''))}" />${help}</label>`;
}

function socSheetHtml() {
  const p = socPlatform();
  if (!p) return '';
  const m = socMode() || { targetLabel: 'Какво търсим', hint: '', example: '' };
  const required = (p.options || []).filter((o) => !o.advanced);
  const advanced = (p.options || []).filter((o) => o.advanced);
  const est = Number(socForm.options.resultsPerPage || socForm.options.resultsLimit || 30) * 0.004;

  return `
    <div class="grid grid-2" style="margin-bottom:14px">
      ${(socInfo.platforms || [])
        .map(
          (x) => `<button type="button" class="soc-plat${socForm.platform === x.id ? ' active' : ''}" data-soc-plat="${x.id}">
            <div class="soc-plat-top"><span class="soc-plat-icon">${x.icon}</span><b>${esc(x.label)}</b></div>
            <div class="hint">${x.needsLogin ? '🔐 ' : '✅ '}${esc(x.note)}</div>
          </button>`
        )
        .join('')}
    </div>

    <div class="card">
      <div class="card-title">1️⃣ Как търсим</div>
      <div class="sc-tabs" style="margin-bottom:12px">
        ${(p.modes || [])
          .map(
            (x) => `<button type="button" class="sc-tab${socForm.mode === x.id ? ' active' : ''}" data-soc-mode="${x.id}">${esc(x.label)}</button>`
          )
          .join('')}
      </div>
      <label class="field"><span>${esc(m.targetLabel)}</span>
        <textarea data-soc="targets" rows="4" placeholder="${esc(m.example)}">${esc(socForm.targets)}</textarea>
        <div class="hint">${esc(m.hint)}</div>
      </label>
    </div>

    <div class="card">
      <div class="card-title">2️⃣ Опции <span class="muted">— какво да събираме</span></div>
      <div class="grid grid-3">${required.map(socOptionHtml).join('')}</div>
      <button type="button" class="btn btn-sm btn-ghost" data-soc="adv-toggle">
        ${socForm.advanced ? '▲ Скрий разширените' : '⚙️ Разширени опции (' + advanced.length + ')'}
      </button>
      <div id="soc-adv" style="display:${socForm.advanced ? '' : 'none'};margin-top:12px">
        <div class="grid grid-3">${advanced.map(socOptionHtml).join('')}</div>
      </div>
      <div class="hint" style="margin-top:12px">
        Ориентировъчна цена: <b>≈ $${est.toFixed(3)}</b> за това пускане
        (плаща се на резултат; нашият дневен лимит важи и тук).
      </div>
    </div>

    <div class="card">
      <div class="card-title">3️⃣ Пусни</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary" data-soc="run">▶️ Пусни сканирането</button>
        <button type="button" class="btn" data-soc="save-defaults">💾 Запази като настройки по подразбиране</button>
      </div>
      <div id="soc-run-status" style="margin-top:12px"></div>
    </div>`;
}

function socItemCard(it, i) {
  const badge = [
    it.is_ad ? '<span class="pill pill-red">РЕКЛАМА</span>' : '',
    it.has_shop ? '<span class="pill pill-gold">с продукт</span>' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const tags = (it.hashtags || [])
    .slice(0, 8)
    .map((h) => `<span class="pill">#${esc(h)}</span>`)
    .join(' ');
  return `<div class="soc-item">
    <div class="soc-rank">${i + 1}</div>
    <div style="flex:1;min-width:0">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        <b>${num(it.views || 0)}</b> гледания · ${num(it.likes || 0)} 👍 · ${num(it.comments || 0)} 💬
        ${it.duration ? ` · ${it.duration} сек` : ''} ${badge}
      </div>
      <div class="hint">@${esc(it.author || '?')} · ${esc(it.posted_at ? dt(it.posted_at) : '—')}</div>
      <div style="margin:6px 0;font-size:13.5px">${esc((it.caption || '').slice(0, 260))}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${tags}</div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-sm btn-ghost" href="${esc(it.url)}" target="_blank" rel="noopener">🔗 Отвори</a>
        <button type="button" class="btn btn-sm btn-ok" data-soc-idea="${esc(it.id)}">💡 Запази като идея</button>
      </div>
    </div>
  </div>`;
}

async function socLoadItems(box) {
  const pane = document.getElementById('soc-pane-items');
  if (!pane) return;
  const f = socItemsFilter;
  const qs = new URLSearchParams({ limit: '60', sort: f.sort });
  if (f.platform) qs.set('platform', f.platform);
  if (f.run) qs.set('run', f.run);
  if (f.q) qs.set('q', f.q);
  if (f.minViews) qs.set('minViews', String(f.minViews));
  if (f.onlyAds) qs.set('onlyAds', 'true');
  if (f.onlyShop) qs.set('onlyShop', 'true');
  const data = await api('/social/items?' + qs.toString());
  const rows = data.items || [];
  const list = document.getElementById('soc-items-list');
  const runs = (socInfo?.runs || [])
    .map((r) => `<option value="${esc(r.id)}" ${f.run === r.id ? 'selected' : ''}>${esc(dt(r.started_at))} · ${esc(r.platform)} · ${num(r.found)}</option>`)
    .join('');
  pane.innerHTML = `
    <div class="card">
      <div class="card-title">📊 Резултати <span class="muted">— ${num(rows.length)} показани</span></div>
      <div class="grid grid-4">
        <label class="field"><span>Платформа</span><select data-soc-f="platform">
          <option value="">Всички</option>
          <option value="tiktok" ${f.platform === 'tiktok' ? 'selected' : ''}>TikTok</option>
          <option value="instagram" ${f.platform === 'instagram' ? 'selected' : ''}>Instagram</option>
        </select></label>
        <label class="field"><span>Пускане</span><select data-soc-f="run"><option value="">Всички</option>${runs}</select></label>
        <label class="field"><span>Подреди по</span><select data-soc-f="sort">
          <option value="views" ${f.sort === 'views' ? 'selected' : ''}>Гледания</option>
          <option value="likes" ${f.sort === 'likes' ? 'selected' : ''}>Харесвания</option>
          <option value="comments" ${f.sort === 'comments' ? 'selected' : ''}>Коментари</option>
          <option value="recent" ${f.sort === 'recent' ? 'selected' : ''}>Най-нови</option>
        </select></label>
        <label class="field"><span>Минимум гледания</span><input type="number" data-soc-f="minViews" value="${f.minViews || 0}" min="0" /></label>
      </div>
      <div class="grid grid-3">
        <label class="field"><span>Търси в текста</span><input type="text" data-soc-f="q" value="${esc(f.q)}" placeholder="напр. спестяване" /></label>
        <label class="soc-opt soc-opt-check"><input type="checkbox" data-soc-f="onlyAds" ${f.onlyAds ? 'checked' : ''} /><span><b>Само реклами</b></span></label>
        <label class="soc-opt soc-opt-check"><input type="checkbox" data-soc-f="onlyShop" ${f.onlyShop ? 'checked' : ''} /><span><b>Само с продукт</b></span></label>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary btn-sm" data-soc="apply">🔎 Покажи</button>
        <button type="button" class="btn btn-sm" data-soc="csv">⬇️ Свали CSV</button>
      </div>
    </div>
    <div class="card">
      ${rows.length ? rows.map(socItemCard).join('') : '<div class="hint">Още няма резултати. Пусни сканиране от „🚀 Ново сканиране“.</div>'}
    </div>`;
  pane.querySelectorAll('[data-soc-f]').forEach((el) => {
    el.onchange = () => {
      const k = el.dataset.socF;
      socItemsFilter[k] = el.type === 'checkbox' ? el.checked : k === 'minViews' ? Number(el.value) || 0 : el.value;
      socLoadItems(box);
    };
  });
  pane.querySelectorAll('[data-soc]').forEach((b) => {
    if (b.dataset.soc === 'apply') b.onclick = () => socLoadItems(box);
    if (b.dataset.soc === 'csv') b.onclick = () => socDownloadCsv();
  });
  pane.querySelectorAll('[data-soc-idea]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api('/social/ideas', { method: 'POST', body: { itemId: b.dataset.socIdea } });
        toast(r.ok ? 'Записано в „Идеи за скриптове“' : r.reason || 'Не стана');
      } catch (e) {
        toast(e.message, 'err');
      }
      b.disabled = false;
    };
  });
  enhanceSelects();
}

/** CSV се сваля с истинска заявка — иначе браузърът губи заглавката за вход. */
function socDownloadCsv() {
  const f = socItemsFilter;
  const qs = new URLSearchParams({ limit: '300', sort: f.sort });
  if (f.platform) qs.set('platform', f.platform);
  if (f.run) qs.set('run', f.run);
  if (f.minViews) qs.set('minViews', String(f.minViews));
  fetch('/api/admin/social/export?' + qs.toString(), { headers: { Authorization: `Bearer ${state.token}` } })
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `social-${f.platform || 'vsi'}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((e) => toast('Свалянето не стана: ' + e.message, 'err'));
}

async function socLoadIdeas() {
  const pane = document.getElementById('soc-pane-ideas');
  if (!pane) return;
  const data = await api('/social/ideas?limit=100');
  const rows = data.items || [];
  pane.innerHTML = `
    <div class="card">
      <div class="card-title">💡 Идеи за скриптове <span class="muted">— ${num(rows.length)} запазени</span></div>
      <div class="hint">Тук пазиш доказано работещи видеа, от които ще пишем наши скриптове. Добави си бележка и куката, която искаш да използваш.</div>
    </div>
    ${
      rows.length
        ? rows
            .map(
              (r) => `<div class="card">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <b>${num(r.views || 0)}</b> гледания · @${esc(r.author || '?')} · ${esc(r.platform)}
        <a class="btn btn-sm btn-ghost" href="${esc(r.url)}" target="_blank" rel="noopener">🔗 Отвори</a>
        <button type="button" class="btn btn-sm btn-danger" data-soc-del="${esc(r.id)}">🗑 Махни</button>
      </div>
      <div class="hint" style="margin:8px 0">${esc((r.caption || '').slice(0, 220))}</div>
      <div class="grid grid-2">
        <label class="field"><span>Каква кука ще ползваме</span>
          <input type="text" data-soc-hook="${esc(r.id)}" value="${esc(r.hook || '')}" placeholder="напр. „Платих 84 лв за пет неща…“" /></label>
        <label class="field"><span>Бележка</span>
          <input type="text" data-soc-note="${esc(r.id)}" value="${esc(r.note || '')}" placeholder="защо ни е полезна" /></label>
      </div>
      <button type="button" class="btn btn-sm btn-ok" data-soc-idea-save="${esc(r.id)}">💾 Запази бележката</button>
    </div>`
            )
            .join('')
        : '<div class="card"><div class="hint">Още няма запазени идеи. От „📊 Резултати“ натисни „💡 Запази като идея“.</div></div>'
    }`;
  pane.querySelectorAll('[data-soc-del]').forEach((b) => {
    b.onclick = async () => {
      await api('/social/ideas/' + b.dataset.socDel, { method: 'DELETE' });
      toast('Махнато');
      socLoadIdeas();
    };
  });
  pane.querySelectorAll('[data-soc-idea-save]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.socIdeaSave;
      const hook = (document.querySelector(`[data-soc-hook="${id}"]`) || {}).value || '';
      const note = (document.querySelector(`[data-soc-note="${id}"]`) || {}).value || '';
      await api('/social/ideas', { method: 'POST', body: { itemId: id, hook, note } });
      toast('Записано');
    };
  });
}

async function socLoadHist() {
  const pane = document.getElementById('soc-pane-hist');
  if (!pane) return;
  const data = await api('/social/runs?limit=40');
  const rows = data.items || [];
  socInfo.runs = rows;
  pane.innerHTML = `
    <div class="card">
      <div class="card-title">📜 История на сканиранията</div>
      ${
        rows.length
          ? `<div class="table-wrap"><table>
        <thead><tr><th>Кога</th><th>Платформа</th><th>Какво търсихме</th><th>Намерени</th><th>Похарчено</th><th>Състояние</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr>
          <td>${esc(dt(r.started_at))}</td>
          <td>${esc(r.platform)}</td>
          <td>${esc((r.targets || []).join(', ').slice(0, 46))}</td>
          <td><b>${num(r.found)}</b></td>
          <td>$${Number(r.usd || 0).toFixed(3)}</td>
          <td>${r.status === 'done' ? '<span class="pill pill-green">готово</span>' : r.status === 'running' ? '<span class="pill pill-gold">върви</span>' : '<span class="pill pill-red">провал</span>'}<div class="hint">${esc((r.note || '').slice(0, 90))}</div></td>
          <td><button type="button" class="btn btn-sm btn-ghost" data-soc-show="${esc(r.id)}">Виж</button></td>
        </tr>`
          )
          .join('')}</tbody></table></div>`
          : '<div class="hint">Още няма пускания.</div>'
      }
    </div>`;
  pane.querySelectorAll('[data-soc-show]').forEach((b) => {
    b.onclick = () => {
      socItemsFilter.run = b.dataset.socShow;
      socItemsFilter.platform = '';
      socSwitchTab('items');
      socLoadItems(document.getElementById('page'));
    };
  });
}

async function socLoadSetup() {
  const pane = document.getElementById('soc-pane-setup');
  if (!pane) return;
  const d = socInfo.defaults || {};
  pane.innerHTML = `
    <div class="card">
      <div class="card-title">⚙️ Настройки по подразбиране</div>
      <div class="hint">Попълват се сами при отваряне на „🚀 Ново сканиране“ — за да не пишеш едно и също всеки път.</div>
      <div class="grid grid-2" style="margin-top:12px">
        <label class="field"><span>Платформа</span><select id="soc-d-plat">
          <option value="tiktok" ${d.platform === 'tiktok' ? 'selected' : ''}>TikTok</option>
          <option value="instagram" ${d.platform === 'instagram' ? 'selected' : ''}>Instagram</option>
        </select></label>
        <label class="field"><span>Резултати на заявка</span><input type="number" id="soc-d-per" value="${num(d.resultsPerPage || 30)}" min="5" max="200" /></label>
        <label class="field"><span>Минимум гледания</span><input type="number" id="soc-d-views" value="${num(d.minViews || 0)}" min="0" /></label>
        <label class="soc-opt soc-opt-check"><input type="checkbox" id="soc-d-noads" ${d.excludeAds ? 'checked' : ''} /><span><b>Без реклами по подразбиране</b></span></label>
      </div>
      <label class="field"><span>Темите, с които обикновено работим</span>
        <textarea id="soc-d-tags" rows="4">${esc(d.hashtags || '')}</textarea>
        <div class="hint">По един на ред. Това са нашите теми: цени, спестяване, пазаруване…</div>
      </label>
      <button type="button" class="btn btn-primary" data-soc="save-setup">💾 Запази настройките</button>
    </div>

    <div class="card">
      <div class="card-title">🔐 Instagram — вход (sessionid)</div>
      <div class="hint">
        Instagram БЕЗ вход връща празни записи (проверено на живо). За да работи, сложи стойността на
        бисквитката <b>sessionid</b> от влязъл в Instagram профил (в браузъра: Разработчик → Application →
        Cookies → instagram.com → sessionid). Пази се само в нашата база и никога не се показва обратно в панела.
      </div>
      <div class="hint" style="margin:10px 0">
        Състояние: ${socInfo.hasInstagramCookie ? '<span class="pill pill-green">има записана бисквитка</span>' : '<span class="pill pill-red">няма бисквитка — Instagram няма да работи</span>'}
      </div>
      <label class="field"><span>Нова стойност (остави празно, за да я изтриеш)</span>
        <input type="password" id="soc-ig-cookie" placeholder="sessionid=…" autocomplete="off" /></label>
      <button type="button" class="btn btn-warn" data-soc="save-cookie">💾 Запази бисквитката</button>
    </div>`;
  pane.querySelectorAll('[data-soc]').forEach((b) => {
    if (b.dataset.soc === 'save-setup') {
      b.onclick = async () => {
        await api('/social/defaults', {
          method: 'POST',
          body: {
            platform: document.getElementById('soc-d-plat').value,
            resultsPerPage: Number(document.getElementById('soc-d-per').value) || 30,
            minViews: Number(document.getElementById('soc-d-views').value) || 0,
            excludeAds: document.getElementById('soc-d-noads').checked,
            hashtags: document.getElementById('soc-d-tags').value,
          },
        });
        toast('Настройките са запазени');
      };
    }
    if (b.dataset.soc === 'save-cookie') {
      b.onclick = async () => {
        const r = await api('/social/instagram-cookie', {
          method: 'POST',
          body: { cookie: document.getElementById('soc-ig-cookie').value },
        });
        socInfo.hasInstagramCookie = Boolean(r.hasCookie);
        toast(r.hasCookie ? 'Бисквитката е записана' : 'Бисквитката е изтрита');
        socLoadSetup();
      };
    }
  });
  enhanceSelects();
}

/** Чакаме пускането и опресняваме статуса — иначе човекът не знае какво става. */
function socPollRun(box) {
  socStopPoll();
  const tick = async () => {
    try {
      const { run } = await api('/social/last');
      const el = document.getElementById('soc-run-status');
      if (el && run) {
        el.innerHTML = run.running === false || run.status !== 'running'
          ? `<div class="hint">${run.status === 'done' ? '<span class="pill pill-green">готово</span>' : '<span class="pill pill-red">провал</span>'} ${esc(run.note || '')} · $${Number(run.usd || 0).toFixed(3)}</div>
             ${run.found ? '<div style="margin-top:8px"><button type="button" class="btn btn-sm btn-ok" data-soc="goto-items">📊 Виж ' + num(run.found) + ' резултата</button></div>' : ''}`
          : `<div class="hint"><span class="spinner"></span> Върви… (TikTok отнема 20–60 сек)</div>`;
        const go = el.querySelector('[data-soc="goto-items"]');
        if (go) {
          go.onclick = () => {
            socItemsFilter.run = run.id || '';
            socItemsFilter.platform = '';
            socSwitchTab('items');
            socLoadItems(box);
          };
        }
      }
      if (!run || run.status === 'running') socRunning = setTimeout(tick, 6000);
      else {
        socLoadHist();
        socUpdateStats();
      }
    } catch {
      socRunning = setTimeout(tick, 8000);
    }
  };
  void tick();
}

function socUpdateStats() {
  const el = document.getElementById('soc-stats');
  if (!el || !socInfo) return;
  const s = socInfo.stats || {};
  el.innerHTML = `
    <div class="pill">📼 ${num(s.items)} събрани видеа</div>
    <div class="pill">🔁 ${num(s.runs)} пускания</div>
    <div class="pill">💡 ${num(s.ideas)} идеи</div>
    <div class="pill ${s.usdToday > 0 ? 'pill-gold' : ''}">💵 днес $${Number(s.usdToday || 0).toFixed(3)}</div>
    ${socInfo.hasInstagramCookie ? '<div class="pill pill-green">🔐 Instagram: вход сложен</div>' : '<div class="pill pill-red">🔐 Instagram: без вход</div>'}`;
}

async function renderSocial(box) {
  socStopPoll();
  socInfo = await api('/social/info');
  const d = socInfo.defaults || {};
  // Формата се пълни от настройките — но само първия път.
  if (!socForm.targets) {
    socForm.platform = d.platform || 'tiktok';
    socForm.targets = d.hashtags || '';
  }
  socForm.options = {
    ...(socForm.platform === 'instagram'
      ? { resultsLimit: d.resultsPerPage || 30 }
      : { resultsPerPage: d.resultsPerPage || 30 }),
    minViews: d.minViews || 0,
    excludeAds: d.excludeAds !== false,
    ...socForm.options,
  };
  socInfo.runs = [];

  box.innerHTML = `
    <div class="card">
      <div class="card-title">🎬 Социални мрежи <span class="muted">— TikTok и Instagram за рекламно проучване</span></div>
      <div class="hint">
        Тук събираме <b>доказано работещи видеа</b> по нашите теми: колко гледания имат, кои са реклами
        (значи конкурентите харчат пари), кои продават продукт и каква кука ползват. Всичко минава през
        дневния лимит на Apify.
      </div>
      <div id="soc-stats" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"></div>
    </div>
    ${socTabsHtml()}
    <div class="sc-pane active" id="soc-pane-new" style="display:block"></div>
    <div class="sc-pane" id="soc-pane-items" style="display:none"></div>
    <div class="sc-pane" id="soc-pane-ideas" style="display:none"></div>
    <div class="sc-pane" id="soc-pane-hist" style="display:none"></div>
    <div class="sc-pane" id="soc-pane-setup" style="display:none"></div>
    <div class="sc-pane" id="soc-pane-auto" style="display:none"></div>`;

  document.querySelectorAll('[data-soc-tab]').forEach((b) => {
    b.onclick = () => {
      socSwitchTab(b.dataset.socTab);
      if (b.dataset.socTab === 'items') socLoadItems(box);
      if (b.dataset.socTab === 'ideas') socLoadIdeas();
      if (b.dataset.socTab === 'hist') socLoadHist();
      if (b.dataset.socTab === 'setup') socLoadSetup();
      if (b.dataset.socTab === 'auto') socLoadAuto(box);
    };
  });

  const bindSheet = () => {
    const pane = document.getElementById('soc-pane-new');
    if (!pane) return;
    pane.querySelectorAll('[data-soc-plat]').forEach((b) => {
      b.onclick = () => {
        socForm.platform = b.dataset.socPlat;
        socForm.mode = (socPlatform()?.modes || [])[0]?.id || 'hashtag';
        socForm.options = {};
        socRenderSheet();
      };
    });
    pane.querySelectorAll('[data-soc-mode]').forEach((b) => {
      b.onclick = () => {
        socForm.mode = b.dataset.socMode;
        socRenderSheet();
      };
    });
    pane.querySelectorAll('[data-soc-opt]').forEach((el) => {
      const k = el.dataset.socOpt;
      const read = () => (el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) || 0 : el.value);
      socForm.options[k] = read();
      el.onchange = () => {
        socForm.options[k] = read();
        socRenderSheet();
      };
    });
    const ta = pane.querySelector('[data-soc="targets"]');
    if (ta) ta.oninput = () => {
      socForm.targets = ta.value;
    };
    const adv = pane.querySelector('[data-soc="adv-toggle"]');
    if (adv)
      adv.onclick = () => {
        socForm.advanced = !socForm.advanced;
        socRenderSheet();
      };
    const run = pane.querySelector('[data-soc="run"]');
    if (run)
      run.onclick = async () => {
        run.disabled = true;
        try {
          const r = await api('/social/scan', {
            method: 'POST',
            body: {
              platform: socForm.platform,
              mode: socForm.mode,
              targets: socForm.targets,
              options: socForm.options,
            },
          });
          if (!r.started) {
            document.getElementById('soc-run-status').innerHTML = `<div class="hint warn">${esc(r.reason || 'Не тръгна.')}</div>`;
          } else {
            toast('Пуснато — чакам резултатите');
            socPollRun(box);
          }
        } catch (e) {
          toast(e.message, 'err');
        }
        run.disabled = false;
      };
    const sd = pane.querySelector('[data-soc="save-defaults"]');
    if (sd)
      sd.onclick = async () => {
        await api('/social/defaults', {
          method: 'POST',
          body: {
            platform: socForm.platform,
            resultsPerPage: Number(socForm.options.resultsPerPage || socForm.options.resultsLimit || 30),
            minViews: Number(socForm.options.minViews || 0),
            excludeAds: socForm.options.excludeAds !== false,
            hashtags: socForm.targets,
          },
        });
        toast('Записано като настройки по подразбиране');
      };
  };

  const socRenderSheet = () => {
    const pane = document.getElementById('soc-pane-new');
    if (!pane) return;
    pane.innerHTML = socSheetHtml();
    bindSheet();
    enhanceSelects();
  };
  window.__socRenderSheet = socRenderSheet;

  socRenderSheet();
  socUpdateStats();
  if (socInfo.running) socPollRun(box);
}


/* ------------------------------------------------ 🔧 двигатели (Скрапер) */

/**
 * Всяка стъпка от обиколката като ключ вкл./изкл. — за да е прозрачно какво
 * работи, кое харчи пари и какво се случва, ако се изключи.
 */
function scraperEnginesHtml(engines) {
  if (!engines || !engines.length) {
    return '<div class="card"><div class="hint">Превключвателите не се заредиха. Презареди страницата.</div></div>';
  }
  const groups = {};
  engines.forEach((e) => {
    const g = e.group || 'други';
    (groups[g] = groups[g] || []).push(e);
  });
  const onCount = engines.filter((e) => e.on).length;
  return `<div class="card">
    <div class="card-title">🔧 Двигатели на обиколката <span class="muted">— включени ${num(onCount)} от ${num(engines.length)}</span></div>
    <div class="hint">
      Тук се вижда точно с какво се чете един сайт. Всяко копче може да се изключи — тогава тази стъпка се
      пропуска и се минава към следващата. Така спираш нещо, преди да е похарчило пари, и разбираш защо
      даден сайт излиза „ръчно“.
    </div>
  </div>
  ${Object.entries(groups)
    .map(
      ([g, list]) => `<div class="card">
    <div class="card-title">${esc(g)}</div>
    ${list
      .map(
        (e) => `<label class="soc-opt-check" style="margin-bottom:10px;align-items:flex-start">
      <input type="checkbox" data-eng="${esc(e.key)}" ${e.on ? 'checked' : ''} style="margin-top:3px" />
      <span style="flex:1">
        <b>${esc(e.label)}</b>
        ${e.paid ? '<span class="pill pill-gold">харчи пари</span>' : '<span class="pill pill-green">безплатно</span>'}
        <div class="hint" style="margin-top:4px">${esc(e.help)}</div>
        ${e.offEffect ? `<div class="hint" style="margin-top:2px;color:#FCD34D">Ако се изключи: ${esc(e.offEffect)}</div>` : ''}
      </span>
    </label>`
      )
      .join('')}
  </div>`
    )
    .join('')}`;
}

function bindScraperEngines(box) {
  document.querySelectorAll('[data-eng]').forEach((el) => {
    el.onchange = async () => {
      const key = el.dataset.eng;
      el.disabled = true;
      try {
        const r = await api('/scraper/engines', { method: 'POST', body: { key, on: el.checked } });
        toast(`${el.checked ? 'Включен' : 'Изключен'}: ${key}`);
        const fresh = (r && r.engines) || [];
        const pane = document.getElementById('sc-pane-engines');
        if (pane) {
          pane.innerHTML = scraperEnginesHtml(fresh);
          bindScraperEngines(box);
        }
      } catch (e) {
        toast(e.message, 'err');
        el.checked = !el.checked;
      }
      el.disabled = false;
    };
  });
}

/* --------------------------------------------- 🤖 автоматизация (Социални) */

const SOC_WEEKDAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

async function socLoadAuto(box) {
  const pane = document.getElementById('soc-pane-auto');
  if (!pane) return;
  const st = await api('/social/auto');
  const s = st.settings || {};
  pane.innerHTML = `
    <div class="card">
      <div class="card-title">🤖 Автоматично седмично проучване <span class="muted">— по подразбиране ИЗКЛЮЧЕНО</span></div>
      <div class="hint">
        Когато е включено, сървърът сам пуска проучването в избрания ден и час и резултатите влизат в
        „📊 Резултати“ с бележка „Автоматично“. Нищо не се пуска, докато ключът по-долу е изключен.
      </div>
      <label class="soc-opt-check" style="margin-top:12px">
        <input type="checkbox" id="sa-enabled" ${s.enabled ? 'checked' : ''} />
        <span><b>Включи автоматичното проучване</b>
          <div class="hint">Изключено = нищо не се случва само. Включва се и се изключва с това копче.</div></span>
      </label>
      <div class="hint" style="margin:10px 0">
        Състояние: ${st.nextRunAt
          ? `<span class="pill pill-green">включено</span> · следващо: <b>${esc(dt(st.nextRunAt))}</b> (${esc(st.weekdayLabel)})`
          : '<span class="pill pill-red">изключено</span>'}
        ${st.last ? `<br>Последно автоматично: ${esc(dt(st.last.at))} · ${num(st.last.found)} пускания · ${esc(st.last.note || '')}` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Кога и какво</div>
      <div class="grid grid-4">
        <label class="field"><span>Ден</span><select id="sa-wd">
          ${SOC_WEEKDAYS.map((d, i) => `<option value="${i}" ${Number(s.weekday) === i ? 'selected' : ''}>${esc(d)}</option>`).join('')}
        </select></label>
        <label class="field"><span>Час (българско време)</span><input type="number" id="sa-hour" value="${num(s.hour)}" min="0" max="23" /></label>
        <label class="field"><span>Минута</span><input type="number" id="sa-min" value="${num(s.minute)}" min="0" max="59" /></label>
        <label class="field"><span>Как търсим</span><select id="sa-mode">
          <option value="search" ${s.mode === 'search' ? 'selected' : ''}>По търсене (думи)</option>
          <option value="hashtag" ${s.mode === 'hashtag' ? 'selected' : ''}>По хаштаг</option>
        </select></label>
      </div>
      <div class="grid grid-4">
        <label class="field"><span>Колко резултата на платформа</span><input type="number" id="sa-max" value="${num(s.maxResults)}" min="5" max="200" /></label>
        <label class="field"><span>Минимум гледания</span><input type="number" id="sa-views" value="${num(s.minViews)}" min="0" /></label>
      </div>
      <label class="field"><span>Темите (по една на ред)</span>
        <textarea id="sa-topics" rows="4">${esc(s.topics || '')}</textarea>
        <div class="hint">Препоръка: „По търсене“ с български фрази дава по-точни резултати от хаштагове.</div>
      </label>
      <div class="grid grid-3">
        <label class="soc-opt-check"><input type="checkbox" id="sa-tiktok" ${s.tiktok ? 'checked' : ''} /><span><b>TikTok</b><div class="hint">Работи без вход.</div></span></label>
        <label class="soc-opt-check"><input type="checkbox" id="sa-ig" ${s.instagram ? 'checked' : ''} /><span><b>Instagram</b><div class="hint">Иска sessionid (⚙️ Настройки).</div></span></label>
        <label class="soc-opt-check"><input type="checkbox" id="sa-ads" ${s.excludeAds ? 'checked' : ''} /><span><b>Без реклами</b><div class="hint">Изключено = рекламите остават (виждаш какво правят конкурентите).</div></span></label>
      </div>
      <label class="soc-opt-check" style="margin-top:10px">
        <input type="checkbox" id="sa-onstart" ${s.runOnStart ? 'checked' : ''} />
        <span><b>Пробно пускане при рестарт на сървъра</b>
          <div class="hint">За да се види, че работи, без да се чака до уговорения ден.</div></span>
      </label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <button type="button" class="btn btn-primary" data-soc="save-auto">💾 Запази</button>
        <button type="button" class="btn btn-warn" data-soc="run-auto">▶️ Пусни веднага (пробно)</button>
      </div>
      <div id="sa-run"></div>
    </div>`;

  const read = () => ({
    enabled: document.getElementById('sa-enabled').checked,
    weekday: Number(document.getElementById('sa-wd').value),
    hour: Number(document.getElementById('sa-hour').value),
    minute: Number(document.getElementById('sa-min').value),
    mode: document.getElementById('sa-mode').value,
    maxResults: Number(document.getElementById('sa-max').value) || 30,
    minViews: Number(document.getElementById('sa-views').value) || 0,
    topics: document.getElementById('sa-topics').value,
    tiktok: document.getElementById('sa-tiktok').checked,
    instagram: document.getElementById('sa-ig').checked,
    excludeAds: document.getElementById('sa-ads').checked,
    runOnStart: document.getElementById('sa-onstart').checked,
  });

  const save = pane.querySelector('[data-soc="save-auto"]');
  if (save)
    save.onclick = async () => {
      await api('/social/auto', { method: 'POST', body: read() });
      toast('Автоматизацията е запазена');
      socLoadAuto(box);
    };
  const runNow = pane.querySelector('[data-soc="run-auto"]');
  if (runNow)
    runNow.onclick = async () => {
      runNow.disabled = true;
      const el = document.getElementById('sa-run');
      el.innerHTML = '<div class="hint"><span class="spinner"></span> Пускам… (TikTok отнема 20–60 сек)</div>';
      try {
        await api('/social/auto', { method: 'POST', body: read() });
        const r = await api('/social/auto/run', { method: 'POST' });
        el.innerHTML = `<div class="hint">${esc((r.results || []).join(' · ') || 'нищо не тръгна')}</div>`;
        toast('Пуснато — виж „📊 Резултати“');
        socLoadHist();
      } catch (e) {
        el.innerHTML = `<div class="hint warn">${esc(e.message)}</div>`;
      }
      runNow.disabled = false;
    };
  enhanceSelects();
}


/* ==================================================== 💶 ОБЯВИ (ПЛАТЕНИ) ===
 * Админ изглед за частните обяви на потребителите: приходи, активни, плащания,
 * модерация. Парите влизат в Stripe — тук показваме какво е платено и кога,
 * за да има пълен отчет (и за да се вижда кой какво е пуснал).
 */

async function renderListings(box) {
  const info = await api('/listings/info');
  const r = info.revenue || {};
  const t = info.totals || {};
  const cfg = info.config || {};

  const statusLabel = {
    draft: 'Чернова (неплатена)',
    pending_payment: 'Чака плащане',
    active: 'Активна',
    paused: 'Спряна',
    sold: 'Продадена',
    expired: 'Изтекла',
    rejected: 'Махната',
  };

  box.innerHTML = `
    <div class="card">
      <div class="card-title">💶 Обяви от потребители <span class="muted">— приходи и модерация</span></div>
      <div class="grid grid-4">
        <div class="card" style="margin:0"><div class="hint">Приходи днес</div><div style="font-size:22px;font-weight:900;color:#86EFAC">${Number(r.todayEur || 0).toFixed(2)} €</div></div>
        <div class="card" style="margin:0"><div class="hint">Последните 30 дни</div><div style="font-size:22px;font-weight:900">${Number(r.monthEur || 0).toFixed(2)} €</div></div>
        <div class="card" style="margin:0"><div class="hint">Общо приходи</div><div style="font-size:22px;font-weight:900;color:#93C5FD">${Number(r.allTimeEur || 0).toFixed(2)} €</div></div>
        <div class="card" style="margin:0"><div class="hint">Плащания</div><div style="font-size:22px;font-weight:900">${num(r.payments || 0)}</div></div>
      </div>
      <div class="hint" style="margin-top:12px">
        Цена на обява: <b>${Number(cfg.priceEur || 0).toFixed(2)} €</b> за <b>${num(cfg.days || 0)} дни</b>
        · до <b>${num(cfg.maxImages || 0)}</b> снимки · макс <b>${num(cfg.maxActive || 0)}</b> активни на човек.
        Всички обяви: <b>${num(t.all || 0)}</b> (активни ${num(t.active || 0)} · продадени ${num(t.sold || 0)}).
      </div>
    </div>

    <div class="card">
      <div class="card-title">⚙️ Настройки на обявите</div>
      <div class="grid grid-4">
        <label class="field"><span>Цена (€)</span><input type="number" id="l-price" value="${Number(cfg.priceEur || 2)}" step="0.5" min="0.5" /></label>
        <label class="field"><span>Дни на обява</span><input type="number" id="l-days" value="${num(cfg.days || 60)}" min="7" max="365" /></label>
        <label class="field"><span>Макс снимки</span><input type="number" id="l-images" value="${num(cfg.maxImages || 5)}" min="1" max="10" /></label>
        <label class="field"><span>Напомняне преди края (дни)</span><input type="number" id="l-remind" value="${num(cfg.remindBeforeDays || 7)}" min="0" max="60" /></label>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="l-save">💾 Запази настройките</button>
      <div class="hint">Промяната важи за новите обяви. Вече платените запазват своя срок.</div>
    </div>

    <div class="card">
      <div class="card-title">📊 По статус и градове</div>
      <div class="grid grid-2">
        <div>${(info.byStatus || [])
          .map((x) => `<div class="hint">${esc(statusLabel[x.status] || x.status)}: <b>${num(x.count)}</b></div>`)
          .join('') || '<div class="hint">Още няма обяви.</div>'}</div>
        <div>${(info.topCities || []).map((c) => `<div class="hint">${esc(c.city || '—')}: <b>${num(c.count)}</b></div>`).join('') || ''}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">🕒 Последни обяви <span class="muted">— ${num((info.recent || []).length)}</span></div>
      ${
        (info.recent || []).length
          ? `<div class="table-wrap"><table>
        <thead><tr><th>Пусната</th><th>Заглавие</th><th>Човек</th><th>Град</th><th>Цена</th><th>Платено до</th><th>Гледания</th><th>Статус</th><th></th></tr></thead>
        <tbody>${(info.recent || [])
          .map(
            (l) => `<tr>
          <td>${esc(dt(l.created_at))}</td>
          <td>${esc(String(l.title || '').slice(0, 34))}</td>
          <td class="muted">${esc(l.user_email || '—')}</td>
          <td>${esc(l.city || '—')}</td>
          <td>${l.price_eur != null ? Number(l.price_eur).toFixed(2) + ' €' : '—'}</td>
          <td>${l.paid_until ? esc(String(l.paid_until).slice(0, 10)) : '—'}</td>
          <td>${num(l.views_count || 0)}</td>
          <td>${esc(statusLabel[l.status] || l.status)}</td>
          <td><button type="button" class="btn btn-sm btn-danger" data-l-take="${esc(l.id)}">Махни</button></td>
        </tr>`
          )
          .join('')}</tbody></table></div>`
          : '<div class="hint">Още няма пуснати обяви.</div>'
      }
    </div>`;

  const save = document.getElementById('l-save');
  if (save)
    save.onclick = async () => {
      save.disabled = true;
      try {
        await api('/listings/config', {
          method: 'POST',
          body: {
            priceEur: Number(document.getElementById('l-price').value) || 2,
            days: Number(document.getElementById('l-days').value) || 60,
            maxImages: Number(document.getElementById('l-images').value) || 5,
            remindBeforeDays: Number(document.getElementById('l-remind').value) || 7,
          },
        });
        toast('Настройките са запазени');
      } catch (e) {
        toast(e.message, 'err');
      }
      save.disabled = false;
    };

  box.querySelectorAll('[data-l-take]').forEach((b) => {
    b.onclick = async () => {
      const reason = prompt('Защо махаме обявата? (ще се запише в дневника)');
      if (!reason || reason.trim().length < 3) return;
      try {
        await api(`/listings/${b.dataset.lTake}/take-down`, { method: 'POST', body: { reason } });
        toast('Обявата е махната');
        await renderListings(box);
      } catch (e) {
        toast(e.message, 'err');
      }
    };
  });
}


/* ============================================ 👥 СТАТИСТИКА НА ПОТРЕБИТЕЛИТЕ ===
 * Кой, кога и колко пъти влиза, къде отваря, от какво устройство, кой е вътре
 * в момента. Всичко е реално от базата — броячи от auth_events (историята на
 * входовете) и user_screen_views (къде отваря).
 */

let peopleState = { q: '', sort: 'recent', onlyActive: false, openUser: '' };

function bar(value, max, color) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2;
  return `<div style="height:7px;border-radius:4px;background:rgba(148,163,184,0.18);overflow:hidden;margin-top:4px">
            <div style="width:${pct}%;height:100%;background:${color}"></div></div>`;
}

function whenShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'сега';
  if (mins < 60) return `преди ${mins} мин`;
  if (mins < 1440) return `преди ${Math.round(mins / 60)} ч`;
  const days = Math.round(mins / 1440);
  return days < 30 ? `преди ${days} д` : d.toLocaleDateString('bg-BG');
}

async function renderPeople(box) {
  const o = await api('/analytics/overview');
  const users = await api(
    `/analytics/users?limit=60&sort=${peopleState.sort}${peopleState.q ? `&q=${encodeURIComponent(peopleState.q)}` : ''}${
      peopleState.onlyActive ? '&onlyActive=true' : ''
    }`
  );
  // Новите отчети (задържане, източници, път на потребителя). Ако сървърът
  // още не ги познава (по време на деплой) — панелът пак работи.
  const ret = await api('/analytics/retention?weeks=8').catch(() => null);
  const srcRep = await api('/analytics/sources').catch(() => null);
  const fun = await api('/analytics/funnel').catch(() => null);
  const u = o.users || {}, a = o.active || {}, l = o.logins || {}, c = o.content || {};
  const tl = o.timeline || [], maxActive = Math.max(1, ...tl.map((t) => t.active));
  const maxLogin = Math.max(1, ...tl.map((t) => t.logins));
  const screens = o.topScreens || [], maxScreen = Math.max(1, ...screens.map((x) => x.views));
  const maxHour = Math.max(1, ...(o.hourly || []).map((x) => x.logins));

  const srcBars = (rows, color) => {
    const arr = rows || [];
    const mx = Math.max(1, ...arr.map((x) => x.users));
    return arr.length
      ? arr
          .map(
            (x) => `<div style="margin-bottom:6px">
        <div class="hint" style="display:flex;justify-content:space-between"><span>${esc(x.key)}</span><span><b>${num(x.users)}</b></span></div>
        ${bar(x.users, mx, color || '#A78BFA')}</div>`
          )
          .join('')
      : '<div class="hint">още няма данни</div>';
  };
  const funSteps = (fun && fun.steps) || [];
  const funFirst = funSteps.length ? funSteps[0].users || 0 : 0;
  const funMax = Math.max(1, ...funSteps.map((s) => s.users));

  const kpi = (label, value, sub, color) => `
    <div class="card" style="margin:0">
      <div class="hint">${esc(label)}</div>
      <div style="font-size:23px;font-weight:900;${color ? `color:${color}` : ''}">${num(value)}</div>
      ${sub ? `<div class="hint" style="margin-top:2px">${esc(sub)}</div>` : ''}
    </div>`;

  box.innerHTML = `
    <div class="card">
      <div class="card-title">👥 Потребители <span class="muted">— пълна статистика</span></div>
      <div class="grid grid-4">
        ${kpi('Всички потребители', u.total, `потвърдени ${num(u.verified)} · спрени ${num(u.suspended)}`)}
        ${kpi('Нови днес', u.newToday, `7 дни: ${num(u.new7)} · 30 дни: ${num(u.new30)}`, '#86EFAC')}
        ${kpi('Активни днес', a.today, `тази седмица ${num(a.week)} · месец ${num(a.month)}`, '#93C5FD')}
        ${kpi('Вътре в момента', a.now, 'последните 15 минути', '#FCD34D')}
      </div>
      <div class="grid grid-4" style="margin-top:12px">
        ${kpi('Влизания днес', l.today, `7 дни: ${num(l.week)} · 30 дни: ${num(l.month)}`)}
        ${kpi('Неуспешни опити', l.failed7, 'последните 7 дни', l.failed7 > 20 ? '#FCA5A5' : '')}
        ${kpi('Оферти', c.posts, `днес ${num(c.postsToday)}`)}
        ${kpi('Обяви / Аларми', `${num(c.listings)} / ${num(c.alerts)}`, `коментари ${num(c.comments)}`)}
      </div>
    </div>

    <div class="card">
      <div class="card-title">📈 Последните 14 дни <span class="muted">— активни хора и влизания</span></div>
      <div style="display:flex;gap:6px;align-items:flex-end;height:120px;margin-top:8px">
        ${tl
          .map(
            (t) => `<div style="flex:1;text-align:center">
              <div style="height:${Math.round((t.active / maxActive) * 86)}px;min-height:3px;background:#4ADE80;border-radius:4px 4px 0 0"></div>
              <div style="height:${Math.round((t.logins / maxLogin) * 26)}px;min-height:2px;background:#60A5FA;border-radius:3px 3px 0 0;margin-top:2px"></div>
              <div class="hint" style="font-size:9px">${esc(String(t.day).slice(8))}</div>
            </div>`
          )
          .join('')}
      </div>
      <div class="hint" style="margin-top:6px">
        <span style="color:#4ADE80">■</span> активни хора &nbsp;
        <span style="color:#60A5FA">■</span> влизания &nbsp;· максимум за ден: <b>${num(maxActive)}</b> души, <b>${num(maxLogin)}</b> входa
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">📍 Къде отварят най-много <span class="muted">(30 дни)</span></div>
        ${
          screens.length
            ? screens
                .slice(0, 12)
                .map(
                  (x) => `<div style="margin-bottom:8px">
            <div class="hint" style="display:flex;justify-content:space-between">
              <span><b>${esc(x.screen)}</b></span><span>${num(x.views)} отваряния · ${num(x.users)} души</span></div>
            ${bar(x.views, maxScreen, '#38BDF8')}</div>`
                )
                .join('')
            : '<div class="hint">Още няма събрани отваряния. Ще се появят, след като хората ползват приложението.</div>'
        }
      </div>
      <div class="card">
        <div class="card-title">📱 Устройства и часове на влизане</div>
        ${(o.platforms || [])
          .map(
            (p) => `<div class="hint" style="display:flex;justify-content:space-between">
              <span>${esc(p.platform)}</span><span><b>${num(p.logins)}</b> влизания · ${num(p.users)} души</span></div>`
          )
          .join('') || '<div class="hint">Още няма данни.</div>'}
        <div style="display:flex;gap:3px;align-items:flex-end;height:56px;margin-top:12px">
          ${Array.from({ length: 24 })
            .map((_, hh) => {
              const hit = (o.hourly || []).find((x) => x.hour === hh);
              const v = hit ? hit.logins : 0;
              return `<div title="${hh}:00 — ${v}" style="flex:1;height:${Math.max(2, Math.round((v / maxHour) * 54))}px;background:${
                v ? '#FBBF24' : 'rgba(148,163,184,0.25)'
              };border-radius:2px"></div>`;
            })
            .join('')}
        </div>
        <div class="hint" style="margin-top:4px">Влизания по часове (0–23 ч, последните 30 дни)</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📋 Хората <span class="muted">— търсене и подредба</span></div>
      <div class="grid grid-4">
        <label class="field"><span>Търсене (имейл, име, град)</span><input type="text" id="p-q" value="${esc(peopleState.q)}" placeholder="напр. кольо" /></label>
        <label class="field"><span>Подредба</span>
          <select id="p-sort">
            <option value="recent" ${peopleState.sort === 'recent' ? 'selected' : ''}>Последно влизане</option>
            <option value="logins" ${peopleState.sort === 'logins' ? 'selected' : ''}>Най-много влизания</option>
            <option value="active" ${peopleState.sort === 'active' ? 'selected' : ''}>Най-скоро активни</option>
            <option value="new" ${peopleState.sort === 'new' ? 'selected' : ''}>Най-нови профили</option>
          </select></label>
        <label class="field"><span>Само активни (30 дни)</span>
          <input type="checkbox" id="p-only" ${peopleState.onlyActive ? 'checked' : ''} /></label>
        <label class="field"><span>&nbsp;</span>
          <button type="button" class="btn btn-primary btn-sm" id="p-go">Покажи</button></label>
      </div>

      <div class="table-wrap" style="margin-top:12px">
        <table>
          <thead><tr>
            <th>Човек</th><th>Град</th><th>Регистрация</th><th>Последно влизане</th><th>Влизания</th>
            <th>Сесии</th><th>Отваряния (30д)</th><th>Оферти</th><th>Обяви</th><th>Последен екран</th><th>Устройство</th><th>IP</th><th></th>
          </tr></thead>
          <tbody>
            ${(users.items || [])
              .map(
                (r) => `<tr${r.online ? ' style="background:rgba(74,222,128,0.07)"' : ''}>
              <td>${r.online ? '🟢 ' : ''}<b>${esc(r.name || '—')}</b><div class="hint">${esc(r.email)}</div></td>
              <td>${esc(r.city || '—')}</td>
              <td>${esc(String(r.created_at || '').slice(0, 10))}</td>
              <td>${esc(whenShort(r.last_login_at))}</td>
              <td><b>${num(r.login_count)}</b>${r.logins_30 ? `<div class="hint">30д: ${num(r.logins_30)}</div>` : ''}</td>
              <td>${num(r.sessions_count)}</td>
              <td>${num(r.screens_30)}</td>
              <td>${num(r.posts)}</td>
              <td>${num(r.listings)}</td>
              <td class="muted">${esc(r.last_screen || '—')}</td>
              <td class="muted">${esc(r.last_platform || '—')}</td>
              <td class="muted">${esc(r.last_ip || '—')}</td>
              <td><button type="button" class="btn btn-sm" data-p-user="${esc(r.id)}">Виж</button></td>
            </tr>`
              )
              .join('') || '<tr><td colspan="13" class="hint">Няма намерени потребители.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:8px">
        Показани ${num((users.items || []).length)} от ${num(users.total)} потребители.
        Отварянията са от реалното ползване на приложението (събират се от днес нататък).
      </div>
    </div>

    <div class="card">
      <div class="card-title">🔁 Задържане <span class="muted">— връщат ли се хората (по седмица на регистрация)</span></div>
      ${
        ret && (ret.items || []).length
          ? `<div class="table-wrap"><table>
        <thead><tr><th>Седмица</th><th>Нови хора</th><th>Върнали се на 1-вия ден</th><th>Върнали се до 7 дни</th><th>Върнали се до 30 дни</th></tr></thead>
        <tbody>
          ${(ret.items || [])
            .map((r) => {
              const pct = (v, mature) =>
                !mature
                  ? '<span class="muted">—</span>'
                  : r.size
                    ? `<b>${Math.round((v / r.size) * 100)}%</b> <span class="hint">(${num(v)} от ${num(r.size)})</span>`
                    : '<span class="muted">0</span>';
              return `<tr><td>${esc(r.cohort)}</td><td><b>${num(r.size)}</b></td>
            <td>${pct(r.d1, r.mature1)}</td><td>${pct(r.d7, r.mature7)}</td><td>${pct(r.d30, r.mature30)}</td></tr>`;
            })
            .join('')}
        </tbody>
      </table></div>
      <div class="hint" style="margin-top:8px">„—“ значи, че периодът още не е изтекъл (за тази седмица D30 не може да се сметне). Числата в скоби са същинските хора.</div>`
          : '<div class="hint">Още няма данни за задържане — събират се от първото ползване нататък.</div>'
      }
    </div>

    <div class="card">
      <div class="card-title">🌍 Откъде идват хората</div>
      ${
        srcRep
          ? `<div class="grid grid-2">
        <div>
          <div class="hint" style="margin-bottom:6px"><b>Канал</b></div>
          ${srcBars(srcRep.channels, '#FBBF24')}
          <div class="hint" style="margin:12px 0 6px"><b>Първо докосване</b> — utm_source или сайтът, който ги е пратил</div>
          ${srcBars(srcRep.utm, '#60A5FA')}
          ${
            srcRep.untracked
              ? `<div class="hint" style="margin-top:4px">Още <b>${num(srcRep.untracked)}</b> профила са без записан източник (регистрирани преди въвеждането му).</div>`
              : ''
          }
          <div class="hint" style="margin:12px 0 6px"><b>По кой канал е споделена поканата</b></div>
          ${srcBars(srcRep.refChannels, '#34D399')}
        </div>
        <div>
          <div class="hint" style="margin-bottom:6px"><b>Устройство при първи вход</b></div>
          ${srcBars(srcRep.firstDevice, '#F472B6')}
          <div class="hint" style="margin:12px 0 6px"><b>Топ градове</b></div>
          ${srcBars(srcRep.cities, '#38BDF8')}
        </div>
      </div>`
          : '<div class="hint">Още няма данни.</div>'
      }
    </div>

    <div class="card">
      <div class="card-title">🎯 Пътят на потребителя <span class="muted">— къде отпадат хората</span></div>
      ${
        funSteps.length
          ? funSteps
              .map((s, i) => {
                const prev = i > 0 ? funSteps[i - 1].users || 0 : 0;
                const drop = i > 0 && prev > 0 ? Math.round(((prev - s.users) / prev) * 100) : 0;
                return `<div style="margin-bottom:10px">
          <div class="hint" style="display:flex;justify-content:space-between">
            <span><b>${esc(s.label)}</b>${i > 0 && drop > 0 ? ` <span style="color:#FCA5A5">−${drop}%</span>` : ''}</span>
            <span><b>${num(s.users)}</b>${funFirst ? ` <span class="muted">(${Math.round((s.users / funFirst) * 100)}% от регистрираните)</span>` : ''}</span>
          </div>
          ${bar(s.users, funMax, '#34D399')}</div>`;
              })
              .join('')
          : '<div class="hint">Още няма данни.</div>'
      }
      <div class="hint" style="margin-top:6px">Червеното е колко процента от предишната стъпка са отпаднали.</div>
    </div>

    <div id="p-detail"></div>`;

  const go = document.getElementById('p-go');
  if (go)
    go.onclick = async () => {
      peopleState.q = (document.getElementById('p-q') || {}).value || '';
      peopleState.sort = (document.getElementById('p-sort') || {}).value || 'recent';
      peopleState.onlyActive = !!(document.getElementById('p-only') || {}).checked;
      await renderPeople(box);
    };

  box.querySelectorAll('[data-p-user]').forEach((b) => {
    b.onclick = async () => {
      const d = await api(`/analytics/user/${b.dataset.pUser}`);
      const host = document.getElementById('p-detail');
      if (!host) return;
      if (!d.found) {
        host.innerHTML = '<div class="card"><div class="hint">Няма такъв потребител.</div></div>';
        return;
      }
      const p = d.profile || {};
      host.innerHTML = `
        <div class="card">
          <div class="card-title">👤 ${esc(p.name || '—')} <span class="muted">${esc(p.email)}</span>
            <button type="button" class="btn btn-sm" id="p-close" style="float:right">Затвори</button></div>
          <div class="grid grid-4">
            <div class="card" style="margin:0"><div class="hint">Регистрация</div><div><b>${esc(String(p.created_at || '').slice(0, 10))}</b></div></div>
            <div class="card" style="margin:0"><div class="hint">Влизания общо</div><div><b>${num(p.login_count)}</b></div></div>
            <div class="card" style="margin:0"><div class="hint">Последно влизане</div><div><b>${esc(whenShort(p.last_login_at))}</b></div></div>
            <div class="card" style="margin:0"><div class="hint">Видян последно</div><div><b>${esc(whenShort(p.last_seen_at))}</b></div></div>
          </div>
          <div class="hint" style="margin-top:10px">
            Град: <b>${esc(p.city || '—')}</b> · роля: <b>${esc(p.role || '—')}</b> ·
            телефон: <b>${esc(p.phone || '—')}</b> · последен екран: <b>${esc(p.last_screen || '—')}</b> ·
            устройство: <b>${esc(p.last_platform || '—')}</b> · IP: <b>${esc(p.last_ip || '—')}</b>
            ${p.signup_ip ? `· IP при регистрация: <b>${esc(p.signup_ip)}</b>` : ''}
          </div>
          <div class="hint" style="margin-top:6px">
            Оферти: <b>${num((d.counts || {}).posts)}</b> · обяви: <b>${num((d.counts || {}).listings)}</b> ·
            коментари: <b>${num((d.counts || {}).comments)}</b> · аларми: <b>${num((d.counts || {}).alerts)}</b>
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card">
            <div class="card-title">🔑 История на входовете <span class="muted">(последни 100)</span></div>
            <div class="table-wrap" style="max-height:320px;overflow:auto"><table>
              <thead><tr><th>Кога</th><th>Какво</th><th>Устройство</th><th>IP</th></tr></thead>
              <tbody>${(d.logins || [])
                .map(
                  (e) => `<tr><td class="muted">${esc(String(e.created_at).slice(0, 16).replace('T', ' '))}</td>
                  <td>${e.kind === 'login' ? '✅ вход' : e.kind === 'failed' ? '⛔ неуспешен' : esc(e.kind)}</td>
                  <td class="muted">${esc(e.platform || '—')} / ${esc(e.browser || '—')}</td>
                  <td class="muted">${esc(e.ip || '—')}</td></tr>`
                )
                .join('') || '<tr><td colspan="4" class="hint">Още няма записи.</td></tr>'}</tbody>
            </table></div>
          </div>

          <div class="card">
            <div class="card-title">📍 Къде отваря <span class="muted">(всичко)</span></div>
            <div class="table-wrap" style="max-height:320px;overflow:auto"><table>
              <thead><tr><th>Екран</th><th>Отваряния</th><th>Дни</th><th>Последно</th></tr></thead>
              <tbody>${(d.screens || [])
                .map(
                  (x) => `<tr><td>${esc(x.screen)}</td><td><b>${num(x.views)}</b></td><td>${num(x.days)}</td>
                  <td class="muted">${esc(whenShort(x.last_at))}</td></tr>`
                )
                .join('') || '<tr><td colspan="4" class="hint">Още няма отваряния.</td></tr>'}</tbody>
            </table></div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">🕒 Последна активност <span class="muted">(най-новите отваряния)</span></div>
          <div class="hint" style="line-height:20px">
            ${(d.activity || [])
              .slice(0, 40)
              .map((x) => `<div>${esc(String(x.created_at).slice(0, 16).replace('T', ' '))} · <b>${esc(x.screen)}</b> · ${esc(x.platform || '')}</div>`)
              .join('') || '<div>Още няма записи.</div>'}
          </div>
        </div>`;

      const cl = document.getElementById('p-close');
      if (cl) cl.onclick = () => (host.innerHTML = '');
    };
  });
}
