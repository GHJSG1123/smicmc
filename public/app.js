/* =====================================================================
   校园瓜田 · 前端
   纯静态，无构建，直连 Supabase（REST + Auth）
   ===================================================================== */
(function () {
  'use strict';

  /* ================= 配置 ================= */
  const SB   = '/api';   // 走同域代理，由 Netlify 函数转发到 Supabase
  const KEY  = 'sb_publishable_Eu-_IB5Uigc8BZrl6DZb5w_zwPvkjm3';

  const CATEGORIES = [
    { id: '',       label: '全部' },
    { id: 'news',   label: '校园新闻' },
    { id: 'rumor',  label: '传言' },
    { id: 'gossip', label: '八卦' },
    { id: 'leak',   label: '爆料' },
    { id: 'debunk', label: '辟谣' },
    { id: 'help',   label: '求助' }
  ];
  const CAT_LABEL = { news:'校园新闻', rumor:'传言', gossip:'八卦', leak:'爆料', debunk:'辟谣', help:'求助' };
  const CRED = {
    confirmed:  { label:'已证实', cls:'ok' },
    unverified: { label:'待核实', cls:'warn' },
    rumor:      { label:'传言',   cls:'bad' },
    debunked:   { label:'已辟谣', cls:'muted' }
  };
  const REASONS = [
    { id:'privacy', label:'侵犯隐私' },
    { id:'attack',  label:'人身攻击' },
    { id:'rumor',   label:'造谣' },
    { id:'other',   label:'其他' }
  ];

  /* ================= 小工具 ================= */
  const $ = (s, r) => (r || document).querySelector(s);
  const app = $('#app');

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  function relTime(iso) {
    const d = Date.now() - new Date(iso).getTime();
    if (d < 0) return '刚刚';
    const m = Math.floor(d / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const day = Math.floor(h / 24);
    if (day === 1) return '昨天';
    if (day < 30) return day + ' 天前';
    const t = new Date(iso);
    return (t.getMonth() + 1) + ' 月 ' + t.getDate() + ' 日';
  }

  function hue(str) {
    let h = 0;
    for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) % 360;
    return h;
  }
  const avatar = name =>
    '<span class="avatar" style="--h:' + hue(name || '') + '">' + esc((name || '瓜').trim().charAt(0)) + '</span>';

  const badge = c => {
    const m = CRED[c] || CRED.unverified;
    return '<span class="badge ' + m.cls + '">' + m.label + '</span>';
  };

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ================= 网络错误 ================= */
  let netDown = false;
  function showNetBanner() {
    if (netDown) return;
    netDown = true;
    const el = $('#net-banner');
    el.className = 'net-banner';
    el.innerHTML =
      '⚠️ <b>数据接口连不上</b>（Failed to fetch）。<br>' +
      '浏览器请求的是你自己的域名 <code>/api/...</code>，由 Netlify 转发给数据库。' +
      '现在这个转发没生效，通常是 Netlify 函数没部署上。' +
      '点这里测一下：<a href="' + SB + '/rest/v1/posts?select=id&limit=1" target="_blank" rel="noopener">' +
      SB + '/rest/v1/posts?select=id</a><br>' +
      '返回 <code>[]</code> 或 JSON = 正常；返回 404 或"Page not found" = 函数没部署，检查仓库里有没有 <code>netlify/functions/api.js</code>。';
  }

  /* ================= REST ================= */
  async function rest(path, opts) {
    const o = opts || {};
    let res;
    try {
      res = await fetch(SB + '/rest/v1/' + path, {
        method: o.method || 'GET',
        headers: Object.assign({
          apikey: KEY,
          Authorization: 'Bearer ' + KEY,
          'Content-Type': 'application/json'
        }, o.headers || {}),
        body: o.body
      });
    } catch (e) {
      showNetBanner();
      throw new Error('网络不可达');
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
    if (!res.ok) {
      const msg = (data && (data.message || data.hint)) || (typeof data === 'string' ? data : 'HTTP ' + res.status);
      throw new Error(msg);
    }
    return data;
  }

  /* ================= 认证 ================= */
  const SKEY = 'gua:session';
  let session = null;   // { access_token, refresh_token, expires_at, user }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SKEY);
      session = raw ? JSON.parse(raw) : null;
    } catch (e) { session = null; }
  }
  function saveSession(s) {
    session = s;
    if (s) localStorage.setItem(SKEY, JSON.stringify(s));
    else localStorage.removeItem(SKEY);
    paintUserChip();
  }

  async function authFetch(path, opts) {
    const o = opts || {};
    let res;
    try {
      res = await fetch(SB + '/auth/v1/' + path, {
        method: o.method || 'POST',
        headers: Object.assign({
          apikey: KEY,
          'Content-Type': 'application/json'
        }, o.headers || {}),
        body: o.body
      });
    } catch (e) {
      showNetBanner();
      throw new Error('网络不可达');
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
    if (!res.ok) {
      const msg = (data && (data.msg || data.error_description || data.message)) || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return data;
  }

  function packSession(tok) {
    return {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
      user: tok.user
    };
  }

  async function signUp(email, password, nickname) {
    const data = await authFetch('signup', {
      body: JSON.stringify({ email: email, password: password, data: { nickname: nickname } })
    });
    if (data && data.access_token) { saveSession(packSession(data)); return { ok: true, confirmed: true }; }
    return { ok: true, confirmed: false, user: data && data.user };
  }

  async function signIn(email, password) {
    const tok = await authFetch('token?grant_type=password', {
      body: JSON.stringify({ email: email, password: password })
    });
    saveSession(packSession(tok));
    return true;
  }

  async function ensureFresh() {
    if (!session) return null;
    if (session.expires_at - Date.now() > 60000) return session.access_token;
    try {
      const tok = await authFetch('token?grant_type=refresh_token', {
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      const next = packSession(tok);
      if (!next.user) next.user = session.user;
      saveSession(next);
      return next.access_token;
    } catch (e) {
      saveSession(null);
      return null;
    }
  }

  async function signOut() {
    const t = await ensureFresh();
    if (t) { try { await authFetch('logout', { headers: { Authorization: 'Bearer ' + t } }); } catch (e) {} }
    saveSession(null);
  }

  function nick() {
    if (!session || !session.user) return null;
    const u = session.user;
    return (u.user_metadata && u.user_metadata.nickname) || (u.email || '').split('@')[0] || '瓜友';
  }
  function isLoggedIn() { return !!(session && session.user); }

  function paintUserChip() {
    const btn = $('#user-chip');
    if (!btn) return;
    if (isLoggedIn()) {
      const n = nick();
      btn.classList.add('on');
      btn.style.setProperty('--h', hue(n));
      btn.innerHTML = esc(n.charAt(0));
      btn.title = n;
    } else {
      btn.classList.remove('on');
      btn.innerHTML = '<span class="user-dot"></span>';
      btn.title = '登录 / 注册';
    }
  }

  /* ================= 本地身份 ================= */
  function deviceId() {
    let v = localStorage.getItem('gua:device');
    if (!v) {
      v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'd-' + Date.now() + Math.random().toString(36).slice(2);
      localStorage.setItem('gua:device', v);
    }
    return v;
  }
  const A1 = ['柠檬','三教','图书馆','南门','操场','夜宵','早八','期末','天台','五楼'];
  const A2 = ['味的风','常客','守夜人','观察员','吃瓜群众','小分队','老同学','柠檬精'];
  const newAlias = () => A1[Math.floor(Math.random() * A1.length)] + A2[Math.floor(Math.random() * A2.length)];
  function alias() {
    let v = localStorage.getItem('gua:alias');
    if (!v) { v = newAlias(); localStorage.setItem('gua:alias', v); }
    return v;
  }
  function myIds() {
    try { return JSON.parse(localStorage.getItem('gua:mine') || '[]'); } catch (e) { return []; }
  }
  function addMyId(id) {
    const m = myIds();
    if (!m.includes(id)) { m.unshift(id); localStorage.setItem('gua:mine', JSON.stringify(m.slice(0, 300))); }
  }
  const melonKey = id => 'gua:melon:' + id;

  /* ================= 状态 ================= */
  const S = { posts: [], counts: {}, filter: '', sort: 'new', loaded: false, hasAuthorId: false };

  async function probeAuthorId() {
    try { await rest('posts?select=author_id&limit=1'); S.hasAuthorId = true; }
    catch (e) { S.hasAuthorId = false; }
  }

  async function loadPosts(force) {
    if (S.loaded && !force) return;
    const rows = await rest('posts?select=*&status=eq.published&order=created_at.desc&limit=100');
    S.posts = rows || [];
    try {
      const cs = await rest('comments?select=post_id&status=eq.visible&limit=1000');
      const map = {};
      (cs || []).forEach(c => { map[c.post_id] = (map[c.post_id] || 0) + 1; });
      S.counts = map;
    } catch (e) { S.counts = {}; }
    S.loaded = true;
  }

  const filtered = () => {
    let list = S.posts.slice();
    if (S.filter) list = list.filter(p => p.category === S.filter);
    if (S.sort === 'hot') list.sort((a, b) => (b.melon || 0) - (a.melon || 0));
    return list;
  };

  /* ================= 组件 ================= */
  function card(p) {
    const n = S.counts[p.id] || 0;
    const voted = !!localStorage.getItem(melonKey(p.id));
    const strike = p.credibility === 'debunked' ? ' style="text-decoration:line-through;opacity:.55"' : '';
    return '<article class="card" data-id="' + esc(p.id) + '">' +
      '<div class="card-head">' + avatar(p.author_alias) +
        '<div class="card-meta">' +
          '<span class="alias">' + esc(p.author_alias) + '</span>' +
          '<span>·</span><span>' + relTime(p.created_at) + '</span>' +
          (p.school ? '<span>·</span><span>' + esc(p.school) + '</span>' : '') +
        '</div>' +
        '<span style="margin-left:auto">' + badge(p.credibility) + '</span>' +
      '</div>' +
      '<h2 class="card-title"><a href="#/p/' + esc(p.id) + '"><span' + strike + '>' + esc(p.title) + '</span></a></h2>' +
      '<p class="excerpt">' + esc(p.content) + '</p>' +
      '<div class="card-tags"><span class="tag">' + esc(CAT_LABEL[p.category] || '其他') + '</span>' +
        (p.tags || []).slice(0, 3).map(t => '<span class="tag">#' + esc(t) + '</span>').join('') +
      '</div>' +
      '<div class="card-actions">' +
        '<button class="act' + (voted ? ' on' : '') + '" data-act="melon">🍉 <span data-melon>' + (p.melon || 0) + '</span></button>' +
        '<a class="act" href="#/p/' + esc(p.id) + '">💬 ' + n + '</a>' +
        '<button class="act" data-act="report" style="margin-left:auto">举报</button>' +
      '</div>' +
    '</article>';
  }

  const empty = (icon, title, desc, actions) =>
    '<div class="empty"><div class="empty-icon">' + icon + '</div>' +
    '<h3>' + esc(title) + '</h3><p>' + desc + '</p>' +
    (actions ? '<div class="empty-actions">' + actions + '</div>' : '') + '</div>';

  const chipRow = () => '<div class="chips">' + CATEGORIES.map(c =>
    '<button class="chip' + (S.filter === c.id ? ' on' : '') + '" data-cat="' + c.id + '">' + c.label + '</button>'
  ).join('') + '</div>';

  const sortRow = () =>
    '<div class="row spread" style="margin-bottom:14px">' +
      '<div class="row" style="gap:6px">' +
        '<button class="chip' + (S.sort === 'new' ? ' on' : '') + '" data-sort="new">最新</button>' +
        '<button class="chip' + (S.sort === 'hot' ? ' on' : '') + '" data-sort="hot">最热</button>' +
      '</div>' +
      '<span class="hint" id="feed-count">' + S.posts.length + ' 条</span>' +
    '</div>';

  /* ================= 弹窗 ================= */
  function openModal(html) {
    $('#modal-card').innerHTML = html;
    $('#modal').classList.remove('hidden');
  }
  function closeModal() { $('#modal').classList.add('hidden'); }

  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('#modal-card').addEventListener('click', e => {
    const t = e.target.closest('[data-auth-tab]');
    if (t) openAuth(t.dataset.authTab);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  /* ================= 认证弹窗 ================= */
  function openAuth(mode) {
    let tab = mode || 'login';
    const body = () => `
      <div class="auth-tabs">
        <button class="auth-tab ${tab === 'login' ? 'on' : ''}" data-auth-tab="login">登录</button>
        <button class="auth-tab ${tab === 'signup' ? 'on' : ''}" data-auth-tab="signup">注册</button>
      </div>
      <div id="auth-msg"></div>
      <div class="auth-field">
        <label>邮箱</label>
        <input class="input" id="a-email" type="email" placeholder="you@example.com" autocomplete="email" />
      </div>
      ${tab === 'signup' ? `
      <div class="auth-field">
        <label>昵称</label>
        <input class="input" id="a-nick" maxlength="16" placeholder="显示在帖子上的名字" />
      </div>` : ''}
      <div class="auth-field">
        <label>密码</label>
        <input class="input" id="a-pass" type="password" placeholder="${tab === 'signup' ? '至少 6 位' : '你的密码'}" autocomplete="${tab === 'signup' ? 'new-password' : 'current-password'}" />
      </div>
      <button class="btn btn-primary btn-block" id="a-submit" style="margin-top:6px">
        ${tab === 'login' ? '登录' : '注册账号'}
      </button>
      <div class="auth-foot">
        ${tab === 'login'
          ? '还没有账号？点上面的「注册」。'
          : '注册后即可用同一身份在任意设备发帖。'}
      </div>`;

    openModal(body());

    $('#a-submit').addEventListener('click', async () => {
      const email = $('#a-email').value.trim();
      const pass  = $('#a-pass').value;
      const nickname = tab === 'signup' ? ($('#a-nick') ? $('#a-nick').value.trim() : '') : '';
      const msg = $('#auth-msg');

      const fail = m => { msg.innerHTML = '<div class="auth-alert">' + esc(m) + '</div>'; };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('邮箱格式不对');
      if (pass.length < 6) return fail('密码至少 6 位');
      if (tab === 'signup' && !nickname) return fail('请填一个昵称');

      const btn = $('#a-submit');
      btn.disabled = true;
      btn.textContent = '处理中…';
      try {
        if (tab === 'login') {
          await signIn(email, pass);
          closeModal();
          toast('欢迎回来，' + nick());
          route();
        } else {
          const r = await signUp(email, pass, nickname);
          if (r.confirmed) {
            closeModal();
            toast('注册成功，已登录');
            route();
          } else {
            msg.innerHTML = '<div class="auth-alert info">账号已创建，但还需要验证邮箱。<br>去邮箱点确认链接后回来登录。<br>' +
              '（站点管理员可以在 Supabase 后台关掉邮箱验证，这样注册后直接登录。）</div>';
            btn.disabled = false;
            btn.textContent = '注册账号';
          }
        }
      } catch (e) {
        fail(e.message);
        btn.disabled = false;
        btn.textContent = tab === 'login' ? '登录' : '注册账号';
      }
    });
  }

  $('#user-chip').addEventListener('click', () => {
    if (isLoggedIn()) location.hash = '#/me';
    else openAuth('login');
  });

  /* ================= 举报 ================= */
  function openReport(type, id) {
    let reason = 'privacy';
    openModal('<h3>举报内容</h3><p class="modal-sub">请选择理由，我们会尽快处理</p>' +
      '<div class="modal-body" id="r-body">' +
        REASONS.map((r, i) => '<button class="opt' + (i === 0 ? ' on' : '') + '" data-r="' + r.id + '">' + r.label + '</button>').join('') +
      '</div>' +
      '<div class="modal-foot"><button class="btn" id="r-cancel">取消</button>' +
      '<button class="btn btn-danger" id="r-ok">提交举报</button></div>');

    $('#r-body').addEventListener('click', e => {
      const b = e.target.closest('.opt'); if (!b) return;
      $('#r-body').querySelectorAll('.opt').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); reason = b.dataset.r;
    });
    $('#r-cancel').addEventListener('click', closeModal);
    $('#r-ok').addEventListener('click', async () => {
      closeModal();
      try {
        await rest('reports', {
          method: 'POST',
          body: JSON.stringify({ target_type: type, target_id: id, reason: reason })
        });
        toast('已收到举报，谢谢');
      } catch (e) { toast('提交失败：' + e.message); }
    });
  }

  /* ================= 视图：首页 ================= */
  async function viewFeed() {
    app.innerHTML = chipRow() + sortRow() + '<div id="list"></div>';
    $('#list').innerHTML = '<div class="skeleton-list">' +
      '<div class="sk-card"><div class="sk-line w40"></div><div class="sk-line w80"></div><div class="sk-line w60"></div></div>' +
      '<div class="sk-card"><div class="sk-line w30"></div><div class="sk-line w70"></div><div class="sk-line w50"></div></div>' +
      '</div>';
    try { await loadPosts(); }
    catch (e) { $('#list').innerHTML = errState(e); return; }
    paintFeed();
  }

  function errState(e) {
    return empty('📡', '加载失败', esc(e.message) + '<br>检查网络后刷新，或点下面的按钮重试。',
      '<button class="btn" onclick="location.reload()">刷新页面</button>');
  }

  function paintFeed() {
    const box = $('#list'); if (!box) return;
    const list = filtered();
    const c = $('#feed-count'); if (c) c.textContent = list.length + ' 条';

    if (!S.posts.length) {
      box.innerHTML = empty('🍉', '瓜田还没开张', '这里还没有人发帖。可以先填几条示例，看看是什么样子。',
        '<a class="btn btn-primary" href="#/new">发布第一条</a>' +
        '<button class="btn" data-seed="1">填入 8 条示例</button>');
      return;
    }
    if (!list.length) {
      box.innerHTML = empty('🔍', '这个分类还是空的', '换个分类看看，或者自己发一条。',
        '<a class="btn" href="#/new">去发布</a>');
      return;
    }
    box.innerHTML = list.map(card).join('');
  }

  /* ================= 视图：详情 ================= */
  async function viewDetail(id) {
    app.innerHTML = '<div class="loading">加载中…</div>';
    let p;
    try {
      const rows = await rest('posts?id=eq.' + encodeURIComponent(id) + '&select=*');
      p = rows && rows[0];
    } catch (e) { app.innerHTML = errState(e); return; }
    if (!p) {
      app.innerHTML = empty('🫥', '这条瓜不见了', '可能已被删除，或者链接不对。', '<a class="btn" href="#/">回首页</a>');
      return;
    }

    const voted = !!localStorage.getItem(melonKey(p.id));
    const warn = (p.credibility === 'rumor' || p.credibility === 'unverified')
      ? '<div class="notice">⚠️ 该内容尚未证实，请理性判断，不要转发未经核实的细节。</div>' : '';
    const debunk = p.credibility === 'debunked'
      ? '<div class="notice bad">🚫 此内容已被辟谣，原帖保留仅为记录。</div>' : '';

    app.innerHTML =
      '<a class="back-link" href="#/">← 返回</a>' +
      '<article class="detail" data-id="' + esc(p.id) + '">' +
        '<div class="card-head">' + avatar(p.author_alias) +
          '<div class="card-meta"><span class="alias">' + esc(p.author_alias) + '</span>' +
          '<span>·</span><span>' + relTime(p.created_at) + '</span></div>' +
          '<span style="margin-left:auto">' + badge(p.credibility) + '</span>' +
        '</div>' +
        '<h1>' + esc(p.title) + '</h1>' + debunk + warn +
        '<div class="detail-body">' + esc(p.content) + '</div>' +
        '<div class="card-tags" style="margin-top:16px">' +
          '<span class="tag">' + esc(CAT_LABEL[p.category] || '其他') + '</span>' +
          (p.school ? '<span class="tag">' + esc(p.school) + '</span>' : '') +
          (p.tags || []).map(t => '<span class="tag">#' + esc(t) + '</span>').join('') +
        '</div>' +
        '<div class="card-actions">' +
          '<button class="act' + (voted ? ' on' : '') + '" data-act="melon">🍉 <span data-melon>' + (p.melon || 0) + '</span></button>' +
          '<button class="act" data-act="report">举报</button>' +
        '</div>' +
      '</article>' +
      '<h3 class="section-title">评论 <span class="hint" id="c-count"></span></h3>' +
      '<div id="comments"><div class="loading">加载中…</div></div>' +
      '<div class="form comment-form">' +
        '<textarea class="input" id="c-input" rows="3" placeholder="说点什么…（' + esc(nick() || alias()) + '）"></textarea>' +
        '<div class="row spread" style="margin-top:10px">' +
          '<span class="hint">请勿人身攻击或泄露他人隐私</span>' +
          '<button class="btn btn-primary btn-sm" id="c-send">发表评论</button>' +
        '</div>' +
      '</div>';

    loadComments(p.id);

    $('#c-send').addEventListener('click', async () => {
      const el = $('#c-input');
      const val = el.value.trim();
      if (!val) return toast('评论不能为空');
      if (val.length > 500) return toast('评论最多 500 字');
      const btn = $('#c-send');
      btn.disabled = true; btn.textContent = '发送中…';
      try {
        await rest('comments', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ post_id: p.id, parent_id: null, content: val, author_alias: nick() || alias() })
        });
        el.value = '';
        toast('评论已发布');
        loadComments(p.id);
      } catch (e) { toast('发布失败：' + e.message); }
      finally { btn.disabled = false; btn.textContent = '发表评论'; }
    });
  }

  async function loadComments(postId) {
    const box = $('#comments'); if (!box) return;
    let rows;
    try {
      rows = await rest('comments?post_id=eq.' + encodeURIComponent(postId) + '&status=eq.visible&order=created_at.asc&limit=200');
    } catch (e) { box.innerHTML = '<div class="hint">评论加载失败</div>'; return; }

    const top = (rows || []).filter(c => !c.parent_id);
    const kids = (rows || []).filter(c => c.parent_id);
    const cnt = $('#c-count'); if (cnt) cnt.textContent = '(' + (rows || []).length + ')';

    if (!top.length) { box.innerHTML = '<div class="hint" style="padding:6px 0">还没有评论，来说两句。</div>'; return; }

    box.innerHTML = top.map(c => {
      const replies = kids.filter(k => k.parent_id === c.id);
      return '<div class="comment">' + avatar(c.author_alias) +
        '<div class="comment-main">' +
          '<div class="comment-head"><span class="alias">' + esc(c.author_alias) + '</span>' +
          '<span>·</span><span>' + relTime(c.created_at) + '</span></div>' +
          '<div class="comment-body">' + esc(c.content) + '</div>' +
          (replies.length ? '<div class="replies">' + replies.map(r =>
            '<div class="comment">' + avatar(r.author_alias) +
            '<div class="comment-main"><div class="comment-head"><span class="alias">' + esc(r.author_alias) + '</span>' +
            '<span>·</span><span>' + relTime(r.created_at) + '</span></div>' +
            '<div class="comment-body">' + esc(r.content) + '</div></div></div>').join('') + '</div>' : '') +
        '</div></div>';
    }).join('');
  }

  /* ================= 视图：发布 ================= */
  function viewNew() {
    const who = nick() || alias();
    app.innerHTML =
      '<h1 class="page-title">发一条瓜</h1>' +
      (isLoggedIn()
        ? '<div class="notice" style="margin:0 0 14px">已登录，这条会记在你名下：<b>' + esc(who) + '</b></div>'
        : '<div class="notice" style="margin:0 0 14px">当前是匿名发布。' +
          '<a href="#" id="go-login" style="color:#fecdd3;text-decoration:underline">登录</a>' +
          '后会把帖子记在你名下，换设备也能找到。</div>') +
      '<div class="form">' +
        '<div class="field"><label>分类</label><div class="opt-row" id="f-cat">' +
          CATEGORIES.filter(c => c.id).map((c, i) =>
            '<button class="opt' + (i === 0 ? ' on' : '') + '" data-v="' + c.id + '">' + c.label + '</button>').join('') +
        '</div></div>' +
        '<div class="field"><label>可信度 <span class="hint" style="font-weight:400">— 你有多确定</span></label>' +
          '<div class="opt-row" id="f-cred">' +
          '<button class="opt" data-v="confirmed">我亲眼所见</button>' +
          '<button class="opt on" data-v="unverified">我听说的</button>' +
          '<button class="opt" data-v="rumor">朋友的朋友说的</button>' +
        '</div></div>' +
        '<div class="field"><label>学校 / 学院</label>' +
          '<input class="input" id="f-school" placeholder="示例大学 · 计算机学院" maxlength="40" /></div>' +
        '<div class="field"><label>标题<span class="counter" id="c-title">0/40</span></label>' +
          '<input class="input" id="f-title" maxlength="40" placeholder="一句话说清这条瓜" /></div>' +
        '<div class="field"><label>正文<span class="counter" id="c-body">0/1000</span></label>' +
          '<textarea class="input" id="f-body" maxlength="1000" placeholder="时间、地点、经过。不确定的地方请写明「听说」，不要编造细节。"></textarea></div>' +
        '<div class="field"><label>显示名字</label>' +
          '<input class="input" id="f-alias" maxlength="20" value="' + esc(who) + '" /></div>' +
        '<div class="field"><label class="check"><input type="checkbox" id="f-promise" />' +
          '<span>我承诺不发布他人隐私、不捏造事实、不进行人身攻击。</span></label></div>' +
        '<div class="err" id="f-err"></div>' +
        '<button class="btn btn-primary btn-block" id="f-send">发布</button>' +
      '</div>';

    const bind = (sel, def) => {
      let v = def;
      $(sel).addEventListener('click', e => {
        const b = e.target.closest('.opt'); if (!b) return;
        $(sel).querySelectorAll('.opt').forEach(x => x.classList.remove('on'));
        b.classList.add('on'); v = b.dataset.v;
      });
      return () => v;
    };
    const getCat = bind('#f-cat', 'news');
    const getCred = bind('#f-cred', 'unverified');

    const gl = $('#go-login');
    if (gl) gl.addEventListener('click', e => { e.preventDefault(); openAuth('login'); });

    $('#f-title').addEventListener('input', e => { $('#c-title').textContent = e.target.value.length + '/40'; });
    $('#f-body').addEventListener('input', e => { $('#c-body').textContent = e.target.value.length + '/1000'; });

    $('#f-send').addEventListener('click', async () => {
      const err = $('#f-err');
      const show = m => { err.textContent = m; err.classList.add('show'); };
      err.classList.remove('show');

      const title = $('#f-title').value.trim();
      const body  = $('#f-body').value.trim();
      const school = $('#f-school').value.trim();
      const who   = $('#f-alias').value.trim() || newAlias();

      if (!title) return show('标题不能为空');
      if (!body) return show('正文不能为空');
      if (!$('#f-promise').checked) return show('请先勾选承诺');

      const btn = $('#f-send');
      btn.disabled = true; btn.textContent = '发布中…';

      const payload = {
        title: title, content: body,
        category: getCat(), credibility: getCred(),
        school: school || null, tags: [], images: [],
        author_alias: who, status: 'published'
      };
      if (isLoggedIn() && S.hasAuthorId && session.user) payload.author_id = session.user.id;

      try {
        const rows = await rest('posts', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(payload)
        });
        if (rows && rows[0]) addMyId(rows[0].id);
        S.loaded = false;
        toast('发布成功');
        location.hash = rows && rows[0] ? '#/p/' + rows[0].id : '#/';
      } catch (e) {
        show('发布失败：' + e.message);
        btn.disabled = false; btn.textContent = '发布';
      }
    });
  }

  /* ================= 视图：热榜 ================= */
  async function viewHot() {
    app.innerHTML = '<h1 class="page-title">🔥 热榜</h1><div id="hotbox"><div class="loading">加载中…</div></div>';
    try { await loadPosts(); } catch (e) { $('#hotbox').innerHTML = errState(e); return; }

    const list = S.posts.slice().sort((a, b) => (b.melon || 0) - (a.melon || 0)).slice(0, 10);
    if (!list.length) { $('#hotbox').innerHTML = empty('📭', '还没有热度', '等有人发帖之后这里就会有排行。', '<a class="btn" href="#/new">去发布</a>'); return; }

    $('#hotbox').innerHTML = '<div class="card" style="padding:6px 12px">' + list.map((p, i) =>
      '<a class="rank" href="#/p/' + esc(p.id) + '">' +
        '<div class="rank-no ' + (i < 3 ? 'top' + (i + 1) : '') + '">' + (i + 1) + '</div>' +
        '<div class="rank-main"><div class="rank-title">' + esc(p.title) + '</div>' +
        '<div class="rank-meta"><span>🍉 ' + (p.melon || 0) + '</span><span>💬 ' + (S.counts[p.id] || 0) + '</span>' +
        '<span>' + esc(CAT_LABEL[p.category] || '') + '</span></div></div>' +
        badge(p.credibility) +
      '</a>').join('') + '</div>';
  }

  /* ================= 视图：搜索 ================= */
  function viewSearch() {
    app.innerHTML = '<h1 class="page-title">搜索</h1>' +
      '<input class="input" id="s-input" placeholder="搜标题、正文、学校…" autocomplete="off" />' +
      '<div id="s-result" style="margin-top:16px"><div class="loading">加载中…</div></div>';
    const input = $('#s-input');
    const run = () => {
      const q = input.value.trim().toLowerCase();
      const box = $('#s-result');
      if (!q) { box.innerHTML = '<div class="hint">输入关键词开始搜索</div>'; return; }
      const list = S.posts.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.content || '').toLowerCase().includes(q) ||
        (p.school || '').toLowerCase().includes(q));
      box.innerHTML = list.length ? list.map(card).join('')
        : empty('🔍', '没搜到', '换个词试试，或者自己发一条。', '<a class="btn" href="#/new">去发布</a>');
    };
    input.addEventListener('input', run);
    (async () => {
      try { await loadPosts(); run(); }
      catch (e) { $('#s-result').innerHTML = errState(e); }
    })();
    setTimeout(() => input.focus(), 60);
  }

  /* ================= 视图：我的 ================= */
  async function viewMe() {
    app.innerHTML = '<div class="loading">加载中…</div>';
    try { await loadPosts(); } catch (e) { app.innerHTML = errState(e); return; }

    let posts;
    if (isLoggedIn() && S.hasAuthorId) {
      try {
        posts = await rest('posts?author_id=eq.' + session.user.id + '&select=*&order=created_at.desc&limit=50');
      } catch (e) { posts = S.posts.filter(p => myIds().includes(p.id)); }
    } else {
      posts = S.posts.filter(p => myIds().includes(p.id));
    }
    posts = posts || [];

    const name = nick() || alias();
    const first = localStorage.getItem('gua:first') || new Date().toISOString();
    const days = Math.max(1, Math.round((Date.now() - new Date(first).getTime()) / 86400000) + 1);
    const level = posts.length >= 10 ? '资深瓜农' : posts.length >= 3 ? '瓜田常客' : '吃瓜群众';

    app.innerHTML =
      '<div class="profile-card">' +
        '<div class="profile-avatar" style="--h:' + hue(name) + '">' + esc(name.charAt(0)) + '</div>' +
        '<div class="profile-name">' + esc(name) + '</div>' +
        '<div class="profile-sub">' + (isLoggedIn() ? esc(session.user.email) : '未登录 · 身份仅存于本设备') + '</div>' +
        '<div class="profile-stats">' +
          '<div class="stat"><b>' + posts.length + '</b><span>发布</span></div>' +
          '<div class="stat"><b>' + days + '</b><span>天数</span></div>' +
          '<div class="stat"><b>' + level + '</b><span>等级</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="menu-list">' +
        (isLoggedIn()
          ? '<button class="menu-item" id="me-logout">退出登录<span class="arrow">›</span></button>'
          : '<button class="menu-item" id="me-login">登录 / 注册<span class="arrow">›</span></button>') +
        '<a class="menu-item" href="#/admin">管理后台<span class="arrow">›</span></a>' +
      '</div>' +
      '<h3 class="section-title">我发布的 <span class="hint">' + posts.length + '</span></h3>' +
      '<div>' + (posts.length ? posts.map(card).join('')
        : empty('✍️', '还没发过', '你发过的瓜会出现在这里。', '<a class="btn btn-primary" href="#/new">发第一条</a>')) + '</div>';

    const lg = $('#me-login');
    if (lg) lg.addEventListener('click', () => openAuth('login'));
    const lo = $('#me-logout');
    if (lo) lo.addEventListener('click', async () => {
      await signOut();
      toast('已退出登录');
      route();
    });
  }

  /* ================= 管理后台 ================= */
  async function adminRest(path, opts) {
    const pw = sessionStorage.getItem('gua:admin') || '';
    const o = opts || {};
    return rest(path, Object.assign({}, o, {
      headers: Object.assign({ 'x-admin-key': pw }, o.headers || {})
    }));
  }

  const REASON_LABEL = { privacy:'侵犯隐私', attack:'人身攻击', rumor:'造谣', nsfw:'色情低俗', spam:'广告', other:'其他' };

  async function viewAdmin() {
    const pw = sessionStorage.getItem('gua:admin');

    if (!pw) {
      app.innerHTML = '<h1 class="page-title">管理后台</h1>' +
        '<div class="form">' +
          '<div class="field"><label>管理口令</label>' +
            '<input class="input" id="adm-pw" type="password" placeholder="输入口令后回车" />' +
          '</div>' +
          '<button class="btn btn-primary btn-block" id="adm-go">进入</button>' +
          '<div class="hint" style="margin-top:14px;line-height:1.9">' +
            '默认口令 <b style="color:var(--fg-soft)">gua2026</b><br>' +
            '想换的话：Netlify → Site configuration → Environment variables → 新增 <code>ADMIN_PASSWORD</code>' +
          '</div>' +
        '</div>';
      const go = () => {
        const v = $('#adm-pw').value.trim();
        if (!v) return;
        sessionStorage.setItem('gua:admin', v);
        viewAdmin();
      };
      $('#adm-go').addEventListener('click', go);
      $('#adm-pw').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      return;
    }

    app.innerHTML = '<h1 class="page-title">管理后台</h1><div class="loading">加载中…</div>';

    let reports = [], posts = [];
    try {
      const res = await Promise.all([
        adminRest('reports?select=*&order=created_at.desc&limit=30'),
        adminRest('posts?select=*&order=created_at.desc&limit=30')
      ]);
      reports = res[0] || [];
      posts = res[1] || [];
    } catch (e) {
      sessionStorage.removeItem('gua:admin');
      app.innerHTML = '<h1 class="page-title">管理后台</h1>' +
        empty('🔒', '没有权限', esc(e.message) + '<br>口令不对，或者没有配置管理员密钥。',
          '<a class="btn" href="#/admin">重新输入口令</a>');
      return;
    }

    const pending = reports.filter(r => r.status === 'pending');

    app.innerHTML = '<h1 class="page-title">管理后台</h1>' +
      '<div class="admin-bar">' +
        '<span class="hint">待处理举报 <b style="color:var(--red)">' + pending.length + '</b> · 帖子 ' + posts.length + '</span>' +
        '<button class="btn btn-sm" id="adm-exit">退出管理</button>' +
      '</div>' +
      '<div class="notice" style="margin:0 0 16px">如果下面列表一直是空的，通常是 Netlify 里还没配 <code>SUPABASE_SERVICE_KEY</code>，或者口令不对。</div>' +
      '<h3 class="section-title">举报</h3>' +
      (pending.length
        ? '<div class="card" style="padding:4px 14px">' + pending.map(r =>
            '<div class="adm-row">' +
              '<div class="adm-main">' +
                '<div class="adm-title">' + esc(REASON_LABEL[r.reason] || r.reason) + '</div>' +
                '<div class="adm-sub">' + esc(r.target_type) + ' · ' + relTime(r.created_at) + '</div>' +
              '</div>' +
              '<button class="act" data-adm-del="' + (r.target_type === 'comment' ? 'comment' : 'post') + ':' + esc(r.target_id) + '">删内容</button>' +
              '<button class="act" data-adm-ignore="' + esc(r.id) + '">忽略</button>' +
            '</div>').join('') + '</div>'
        : '<div class="hint" style="padding:4px 0 8px">没有待处理的举报</div>') +
      '<h3 class="section-title">最新帖子</h3>' +
      (posts.length
        ? '<div class="card" style="padding:4px 14px">' + posts.map(p =>
            '<div class="adm-row">' +
              '<div class="adm-main">' +
                '<div class="adm-title">' + esc(p.title) + '</div>' +
                '<div class="adm-sub">' + esc(p.author_alias) + ' · ' + relTime(p.created_at) + ' · 🍉 ' + (p.melon || 0) + '</div>' +
              '</div>' +
              '<button class="act" data-adm-del="post:' + esc(p.id) + '">删除</button>' +
            '</div>').join('') + '</div>'
        : '<div class="hint">还没有帖子</div>');

    $('#adm-exit').addEventListener('click', () => {
      sessionStorage.removeItem('gua:admin');
      toast('已退出管理');
      location.hash = '#/me';
    });
  }

  /* ================= 示例数据 ================= */
  const DEMO = [
    { title:'下学期起周三下午不再排课，留给社团活动', content:'教务处通知：从下学期开始，周三下午 14:00–17:00 全校不排课，用于社团活动和体育俱乐部。具体安排开学前发到各学院。', category:'news', credibility:'confirmed', school:'示例大学 · 教务处', tags:['教务','社团'], hours:4 },
    { title:'听说三食堂二楼要改成自习区？', content:'打饭的时候听阿姨说，二楼月底就要搬空改成自习区。问了食堂经理，他说"还在讨论"。反正现在二楼还是正常开着的。', category:'rumor', credibility:'unverified', school:'示例大学 · 三食堂', tags:['食堂'], hours:9 },
    { title:'南门那家奶茶店是不是要关门了', content:'连着三天路过都拉着卷帘门，门口贴了张纸被雨淋花了看不清。旁边小卖部老板说"合同到期了"。', category:'gossip', credibility:'unverified', school:'示例大学 · 南门', tags:[], hours:26 },
    { title:'校运会报名今晚 24 点截止', content:'还没报的抓紧，报名入口在学生服务平台，选"体育赛事"。个人项目最多报两项。', category:'news', credibility:'confirmed', school:'示例大学 · 体育部', tags:['校运会'], hours:30 },
    { title:'图书馆四楼空调坏了三天了有人管吗', content:'四楼东侧那片的空调从上周末开始就不出冷风，靠窗的位置坐不住。已经报修两次了，物业说"配件没到"。', category:'help', credibility:'unverified', school:'示例大学 · 图书馆', tags:['图书馆'], hours:48 },
    { title:'网传"期末提前一周"是不实信息，教务处已回应', content:'这两天群里传的"期末考试提前一周"是假的。教务处今天下午在官网发了说明，考试周安排不变。原帖保留在这里做记录，别再传了。', category:'debunk', credibility:'debunked', school:'示例大学 · 教务处', tags:['期末','辟谣'], hours:52 },
    { title:'快递站搬到北门了，取件别跑错', content:'原来的位置在装修，所有快递临时搬到北门进来左手边那排棚子。营业时间 10:00–20:00，中午休息半小时。', category:'leak', credibility:'confirmed', school:'示例大学 · 北门', tags:['快递'], hours:70 },
    { title:'操场跑道翻新工期延后，体育课改到体育馆', content:'原定这周完工的跑道翻新要推迟到月底。这两周的体育课都改在体育馆上，具体看任课老师通知。', category:'rumor', credibility:'unverified', school:'示例大学 · 体育部', tags:[], hours:96 }
  ];

  async function seedDemo(btn) {
    btn.disabled = true; btn.textContent = '写入中…';
    try {
      for (const d of DEMO) {
        const payload = {
          title: d.title, content: d.content, category: d.category, credibility: d.credibility,
          school: d.school, tags: d.tags || [], images: [], author_alias: newAlias(),
          status: 'published', created_at: new Date(Date.now() - d.hours * 3600000).toISOString()
        };
        await rest('posts', { method: 'POST', body: JSON.stringify(payload) });
      }
      await loadPosts(true);
      paintFeed();
      toast('已写入 8 条示例');
    } catch (e) {
      toast('写入失败：' + e.message);
      btn.disabled = false; btn.textContent = '填入 8 条示例';
    }
  }

  /* ================= 吃瓜 ================= */
  async function doMelon(btn) {
    const holder = btn.closest('.card, .detail'); if (!holder) return;
    const id = holder.dataset.id || location.hash.split('/p/')[1];
    if (!id) return;
    if (localStorage.getItem(melonKey(id))) return toast('你已经吃过这个瓜了');

    try {
      const rows = await rest('reactions', {
        method: 'POST',
        headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
        body: JSON.stringify({ post_id: id, device_id: deviceId(), kind: 'melon' })
      });
      if (!rows || !rows.length) { localStorage.setItem(melonKey(id), '1'); return toast('已经吃过了'); }
    } catch (e) { return toast('操作失败：' + e.message); }

    try { await rest('rpc/add_melon', { method: 'POST', body: JSON.stringify({ p_post_id: id }) }); } catch (e) {}
    localStorage.setItem(melonKey(id), '1');

    const span = btn.querySelector('[data-melon]');
    if (span) span.textContent = (parseInt(span.textContent, 10) || 0) + 1;
    btn.classList.add('on', 'pop');
    setTimeout(() => btn.classList.remove('pop'), 360);
  }

  /* ================= 事件 ================= */
  document.addEventListener('click', async e => {
    const admDel = e.target.closest('[data-adm-del]');
    if (admDel) {
      const parts = admDel.dataset.admDel.split(':');
      const kind = parts[0], id = parts[1];
      if (!confirm('确定删除这条内容？删除后不可恢复。')) return;
      try {
        await adminRest((kind === 'comment' ? 'comments?id=eq.' : 'posts?id=eq.') + id, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' }
        });
        toast('已删除');
        S.loaded = false;
        viewAdmin();
      } catch (err) { toast('删除失败：' + err.message); }
      return;
    }

    const admIgnore = e.target.closest('[data-adm-ignore]');
    if (admIgnore) {
      try {
        await adminRest('reports?id=eq.' + admIgnore.dataset.admIgnore, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'ignored' })
        });
        toast('已忽略');
        viewAdmin();
      } catch (err) { toast('操作失败：' + err.message); }
      return;
    }

    const seedBtn = e.target.closest('[data-seed]');
    if (seedBtn) return seedDemo(seedBtn);

    const melonBtn = e.target.closest('[data-act="melon"]');
    if (melonBtn) return doMelon(melonBtn);

    const reportBtn = e.target.closest('[data-act="report"]');
    if (reportBtn) {
      const holder = reportBtn.closest('.card, .detail');
      const id = holder && (holder.dataset.id || location.hash.split('/p/')[1]);
      if (id) openReport('post', String(id).trim());
      return;
    }

    const chip = e.target.closest('[data-cat]');
    if (chip) {
      S.filter = chip.dataset.cat;
      app.innerHTML = chipRow() + sortRow() + '<div id="list"></div>';
      paintFeed();
      return;
    }

    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      S.sort = sortBtn.dataset.sort;
      const bar = sortBtn.parentElement;
      bar.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('on', b.dataset.sort === S.sort));
      paintFeed();
      return;
    }
  });

  /* ================= 路由 ================= */
  const TABS = { '': 'feed', 'hot': 'hot', 'new': 'new', 'me': 'me', 'search': 'search' };

  async function route() {
    const hash = (location.hash || '#/').replace(/^#/, '');
    const parts = hash.split('/').filter(Boolean);
    const head = parts[0] || '';

    document.querySelectorAll('.tabbar a').forEach(a => {
      a.classList.toggle('on', a.dataset.tab === (TABS[head] || ''));
    });
    window.scrollTo(0, 0);

    if (head === '')            return viewFeed();
    if (head === 'p' && parts[1]) return viewDetail(parts[1]);
    if (head === 'hot')         return viewHot();
    if (head === 'new')         return viewNew();
    if (head === 'search')      return viewSearch();
    if (head === 'me')          return viewMe();
    if (head === 'admin')       return viewAdmin();

    app.innerHTML = empty('🫥', '页面不存在', '链接可能不对。', '<a class="btn" href="#/">回首页</a>');
  }

  window.addEventListener('hashchange', route);

  /* ================= 启动 ================= */
  (async function boot() {
    loadSession();
    paintUserChip();
    if (!localStorage.getItem('gua:first')) localStorage.setItem('gua:first', new Date().toISOString());
    deviceId(); alias();
    paintUserChip();
    await ensureFresh().catch(() => {});
    paintUserChip();
    await probeAuthorId().catch(() => {});
    route();
  })();
})();
