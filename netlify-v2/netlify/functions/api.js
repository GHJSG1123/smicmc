/**
 * Netlify Function：Supabase 反向代理
 *
 * 浏览器 → https://smicmc.qd.je/api/rest/v1/posts
 *        → 本函数（跑在 Netlify 服务器上）
 *        → https://<项目>.supabase.co/rest/v1/posts
 *
 * 这样浏览器永远只跟自己的域名通信，不受国内网络对 supabase.co 的限制；
 * publishable key 也只出现在服务器端，不暴露在前端代码里。
 */

const SUPABASE = 'https://uadpbsgfithscrknqjnu.supabase.co';
const ANON_KEY = 'sb_publishable_Eu-_IB5Uigc8BZrl6DZb5w_zwPvkjm3';

// 管理员口令：优先用 Netlify 环境变量 ADMIN_PASSWORD，没配就用默认值
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const GUARD_CODE = process.env.GUARD_CODE || '';
// 管理员密钥：Netlify 环境变量 SUPABASE_SERVICE_KEY（不要把 service key 写进代码）
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

exports.handler = async function (event) {
  // 兼容两种路径：/api/xxx 和 /.netlify/functions/api/xxx
  let path = event.path || '/';
  path = path.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '');
  if (!path) path = '/';

  if (event.body && String(event.body).length > 600000) {
    return json(413, { message: '内容太大了' });
  }

  /* 用户名 + 密码账号：不经过 Supabase Auth，不发任何邮件 */
  if (path === '/auth/register' || path === '/auth/login') {
    return handleAuth(path === '/auth/register', event);
  }

  /* 个人空间 / 私信 */
  if (path === '/user/get')    return handleUserGet(event);
  if (path === '/user/me')     return handleUserMe(event);
  if (path === '/user/update') return handleUserUpdate(event);
  if (path === '/msg/send')    return handleMsgSend(event);
  if (path === '/msg/inbox')   return handleMsgInbox(event);
  if (path === '/msg/thread')  return handleMsgThread(event);
  if (path === '/melon')       return handleMelon(event);
  if (path === '/post/create')    return handlePostCreate(event);
  if (path === '/comment/create') return handleCommentCreate(event);
  if (path === '/report/create')  return handleReportCreate(event);
  if (path === '/staff/login')     return handleStaffLogin(event);
  if (path === '/post/delete')     return handlePostDelete(event);
  if (path === '/comment/delete')  return handleCommentDelete(event);
  if (path === '/vote')            return handleVote(event);
  if (path === '/evidence')        return handleEvidence(event);
  if (path === '/update/add')      return handleUpdateAdd(event);
  if (path === '/checkin')         return handleCheckin(event);
  if (path === '/leaderboard')     return handleLeaderboard(event);
  if (path === '/boost')           return handleBoost(event);

  if (event.body && String(event.body).length > 30000) {
    return json(413, { message: '内容太大了' });
  }

  const qs = event.rawQuery ? '?' + event.rawQuery : '';
  const target = SUPABASE + path + qs;

  // 管理员请求：带对口令就走 service key（绕过 RLS），否则用公开 key
  const adminHeader = event.headers['x-admin-key'] || '';
  if (adminHeader) {
    if (!ADMIN_PASSWORD || !safeEqual(adminHeader, ADMIN_PASSWORD)) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ message: '管理口令不正确' })
      };
    }
    if (!SERVICE_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ message: '还没有配置 SUPABASE_SERVICE_KEY 环境变量，管理功能不可用' })
      };
    }
  }
  const isAdmin = !!adminHeader;

  const headers = {
    apikey: isAdmin ? SERVICE_KEY : ANON_KEY,
    'Content-Type': 'application/json'
  };

  // 登录用户的 token 透传；没有就用对应的 key
  const auth = event.headers.authorization || event.headers.Authorization;
  headers.Authorization = isAdmin ? 'Bearer ' + SERVICE_KEY : (auth || 'Bearer ' + ANON_KEY);

  if (event.headers.prefer) headers.Prefer = event.headers.prefer;
  if (event.headers['accept-profile']) headers['Accept-Profile'] = event.headers['accept-profile'];

  let body;
  if (event.body) {
    body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
  }

  try {
    const res = await fetch(target, {
      method: event.httpMethod || 'GET',
      headers: headers,
      body: body
    });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: text
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ message: '代理请求失败：' + err.message })
    };
  }
};

/* =====================================================================
   用户名 + 密码账号
   - 账号存在 Supabase 的 profiles 表（只有函数能读写，前端拿不到）
   - 密码用 HMAC-SHA256 加盐存哈希，不存明文
   ===================================================================== */
const crypto = require('crypto');

const PEPPER = process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_KEY || process.env.ADMIN_PASSWORD || require('crypto').randomBytes(32).toString('hex');

function hashPass(username, password) {
  return crypto.createHmac('sha256', PEPPER)
    .update(String(username).toLowerCase() + '\u0000' + password)
    .digest('hex');
}

function json(code, obj) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj)
  };
}

async function sb(path, opts) {
  const o = opts || {};
  const res = await fetch(SUPABASE + '/rest/v1/' + path, {
    method: o.method || 'GET',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: o.prefer || 'return=representation'
    },
    body: o.body
  });
  const text = await res.text();
  if (!res.ok) throw new Error('DB ' + res.status + ': ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

async function handleAuth(isRegister, event) {
  if ((event.httpMethod || 'GET') !== 'POST') return json(405, { message: '只支持 POST' });
  if (!rateLimit('auth:' + clientIp(event), 12, 60000)) {
    return json(429, { message: '操作太频繁，请等一分钟再试' });
  }
  if (!SERVICE_KEY) return json(500, { message: '站点还没配置 SUPABASE_SERVICE_KEY' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { message: '请求格式不对' }); }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (username.length < 2 || username.length > 16) return json(400, { message: '用户名要 2–16 个字' });
  if (password.length < 6) return json(400, { message: '密码至少 6 位' });
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_.-]+$/.test(username)) return json(400, { message: '用户名只能用中文、字母、数字、下划线' });

  try {
    const rows = await sb('profiles?username=eq.' + encodeURIComponent(username) + '&select=id,username,pass_hash,token_version,fail_count,locked_until');
    const exist = rows && rows[0];

    if (isRegister) {
      if (exist) return json(409, { message: '用户名不可用，换一个试试' });
      const created = await sb('profiles', {
        method: 'POST',
        body: JSON.stringify({ username: username, pass_hash: makeScrypt(username, password) })
      });
      const row = created && created[0];
      if (!row) return json(500, { message: '注册失败，请重试' });
      return json(200, { id: row.id, username: row.username, token: makeToken(row.id, row.username, 0) });
    }

    if (!exist) return json(401, { message: '用户名或密码不对' });

    if (exist.locked_until && new Date(exist.locked_until).getTime() > Date.now()) {
      return json(429, { message: '尝试次数过多，请 15 分钟后再试' });
    }

    if (!checkPass(exist.pass_hash, username, password)) {
      const fails = (exist.fail_count || 0) + 1;
      const patch = fails >= 5
        ? { fail_count: 0, locked_until: new Date(Date.now() + 15 * 60000).toISOString() }
        : { fail_count: fails };
      try { await sb('profiles?id=eq.' + exist.id, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(patch) }); } catch (e) {}
      return json(401, { message: '用户名或密码不对' });
    }

    if ((exist.fail_count || 0) > 0 || exist.locked_until) {
      try { await sb('profiles?id=eq.' + exist.id, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ fail_count: 0, locked_until: null }) }); } catch (e) {}
    }

    if (String(exist.pass_hash || '').indexOf('scrypt$') !== 0) {
      try {
        await sb('profiles?id=eq.' + exist.id, {
          method: 'PATCH', prefer: 'return=minimal',
          body: JSON.stringify({ pass_hash: makeScrypt(username, password) })
        });
      } catch (e) {}
    }
    return json(200, { id: exist.id, username: exist.username, token: makeToken(exist.id, exist.username, exist.token_version || 0) });
  } catch (err) {
    const msg = String(err.message || '');
    if (msg.indexOf('duplicate') >= 0 || msg.indexOf('23505') >= 0) {
      return json(409, { message: '用户名不可用，换一个试试' });
    }
    if (msg.indexOf('42P01') >= 0 || msg.indexOf('does not exist') >= 0) {
      return json(500, { message: '还没建 profiles 表，请先在 Supabase 跑建表 SQL' });
    }
    return json(500, { message: '服务器错误：' + msg.slice(0, 120) });
  }
}

/* =====================================================================
   令牌 + 个人空间 + 私信
   ===================================================================== */
const TOKEN_TTL = 30 * 24 * 3600 * 1000;

function makeToken(uid, name, ver) {
  const payload = Buffer.from(JSON.stringify({ u: uid, n: name || '', v: ver || 0, x: Date.now() + TOKEN_TTL })).toString('base64url');
  const sig = crypto.createHmac('sha256', PEPPER).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyToken(tok) {
  if (!tok || String(tok).indexOf('.') < 0) return null;
  const parts = String(tok).split('.');
  const payload = parts[0], sig = parts[1];
  const expect = crypto.createHmac('sha256', PEPPER).update(payload).digest('base64url');
  if (!safeEqual(sig, expect)) return null;
  try {
    const o = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!o.u || !o.x || o.x < Date.now()) return null;
    return o;
  } catch (e) { return null; }
}

/* ---------------- 限流（实例内存，粗粒度） ---------------- */
const RL_BUCKETS = new Map();

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let arr = RL_BUCKETS.get(key) || [];
  arr = arr.filter(t => now - t < windowMs);
  if (arr.length >= max) {
    RL_BUCKETS.set(key, arr);
    return false;
  }
  arr.push(now);
  RL_BUCKETS.set(key, arr);
  if (RL_BUCKETS.size > 5000) RL_BUCKETS.clear();
  return true;
}

function clientIp(event) {
  const h = event.headers || {};
  const raw = h['x-nf-client-connection-ip'] || h['client-ip'] ||
              (h['x-forwarded-for'] || '').split(',')[0] || 'unknown';
  return String(raw).trim().slice(0, 64);
}

/* ---------------- 口令哈希：scrypt（兼容旧的 HMAC） ---------------- */
function makeScrypt(username, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password) + '\u0000' + String(username).toLowerCase(), salt, 32).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

function checkPass(stored, username, password) {
  const s = String(stored || '');
  if (s.indexOf('scrypt$') === 0) {
    const parts = s.split('$');
    if (parts.length !== 3) return false;
    const calc = crypto.scryptSync(String(password) + '\u0000' + String(username).toLowerCase(), parts[1], 32).toString('hex');
    return safeEqual(calc, parts[2]);
  }
  return safeEqual(s, hashPass(username, password));
}

function safeEqual(a, b) {
  try {
    const A = Buffer.from(String(a || ''), 'utf8');
    const B = Buffer.from(String(b || ''), 'utf8');
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
  } catch (e) { return false; }
}

function bearer(event) {
  const h = event.headers.authorization || event.headers.Authorization || '';
  return String(h).replace(/^Bearer\s+/i, '').trim();
}

async function authUid(event) {
  const info = verifyToken(bearer(event));
  if (!info) return null;
  try {
    const rows = await sb('profiles?id=eq.' + info.u + '&select=token_version');
    const v = (rows && rows[0] && rows[0].token_version) || 0;
    if ((info.v || 0) !== v) return null;
  } catch (e) { /* 查询失败时放行，避免误伤 */ }
  return info.u;
}
function authInfo(event) { return verifyToken(bearer(event)); }

function readBody(event) {
  try { return JSON.parse(event.body || '{}'); } catch (e) { return null; }
}

/* ---------------- 个人空间 ---------------- */
async function handleUserGet(event) {
  const body = readBody(event);
  if (!body || !body.username) return json(400, { message: '缺少用户名' });
  try {
    const rows = await sb('profiles?username=eq.' + encodeURIComponent(body.username) + '&select=id,username,bio,tags,created_at');
    const p = rows && rows[0];
    if (!p) return json(404, { message: '没有这个用户' });

    let postCount = 0;
    try {
      const posts = await sb('posts?author_id=eq.' + p.id + '&select=id&limit=1000');
      postCount = (posts || []).length;
    } catch (e) {}

    return json(200, {
      id: p.id, username: p.username, bio: p.bio || '',
      tags: p.tags || [], created_at: p.created_at, postCount: postCount,
      exp: p.exp || 0, streak: p.streak || 0, last_checkin: p.last_checkin || null,
      tickets: p.tickets || 0
    });
  } catch (err) {
    return json(500, { message: '查询失败：' + String(err.message).slice(0, 120) });
  }
}

async function handleUserUpdate(event) {
  const uid = await authUid(event);
  if (!uid) return json(401, { message: '请先登录' });
  const body = readBody(event);
  if (!body) return json(400, { message: '请求格式不对' });

  const bio = String(body.bio || '').slice(0, 120);
  let tags = Array.isArray(body.tags) ? body.tags : [];
  tags = tags.map(function (t) { return String(t).trim().slice(0, 10); })
             .filter(Boolean).slice(0, 6);

  try {
    await sb('profiles?id=eq.' + uid, {
      method: 'PATCH',
      body: JSON.stringify({ bio: bio, tags: tags })
    });
    return json(200, { ok: true, bio: bio, tags: tags });
  } catch (err) {
    return json(500, { message: '保存失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 私信 ---------------- */
async function handleMsgSend(event) {
  if (!rateLimit('msg:' + clientIp(event), 30, 60000)) {
    return json(429, { message: '发得太快了，歇一会儿' });
  }
  const uid = await authUid(event);
  if (!uid) return json(401, { message: '请先登录' });
  const body = readBody(event);
  if (!body) return json(400, { message: '请求格式不对' });

  const to = String(body.to || '').trim();
  const content = String(body.content || '').trim();
  if (!to) return json(400, { message: '缺少收件人' });
  if (!content) return json(400, { message: '内容不能为空' });
  if (content.length > 500) return json(400, { message: '消息最多 500 字' });

  try {
    const rows = await sb('profiles?username=eq.' + encodeURIComponent(to) + '&select=id,username');
    const target = rows && rows[0];
    if (!target) return json(404, { message: '没有这个用户' });
    if (target.id === uid) return json(400, { message: '不能给自己发私信' });

    const created = await sb('messages', {
      method: 'POST',
      body: JSON.stringify({ from_id: uid, to_id: target.id, content: content })
    });
    return json(200, (created && created[0]) || { ok: true });
  } catch (err) {
    return json(500, { message: '发送失败：' + String(err.message).slice(0, 120) });
  }
}

async function handleMsgInbox(event) {
  const uid = await authUid(event);
  if (!uid) return json(401, { message: '请先登录' });
  try {
    const rows = await sb('messages?or=(from_id.eq.' + uid + ',to_id.eq.' + uid +
      ')&order=created_at.desc&limit=200&select=id,from_id,to_id,content,created_at,read_at');
    const list = rows || [];
    const others = {};
    list.forEach(function (m) {
      const other = m.from_id === uid ? m.to_id : m.from_id;
      if (!others[other]) {
        others[other] = { id: other, last: m.content, lastAt: m.created_at, unread: 0 };
      }
      if (m.to_id === uid && !m.read_at) others[other].unread++;
    });
    const ids = Object.keys(others);
    if (ids.length) {
      const profs = await sb('profiles?id=in.(' + ids.join(',') + ')&select=id,username');
      (profs || []).forEach(function (p) { if (others[p.id]) others[p.id].username = p.username; });
    }
    const arr = Object.values(others).sort(function (a, b) {
      return new Date(b.lastAt) - new Date(a.lastAt);
    });
    return json(200, arr);
  } catch (err) {
    return json(500, { message: '读取失败：' + String(err.message).slice(0, 120) });
  }
}

async function handleMsgThread(event) {
  const uid = await authUid(event);
  if (!uid) return json(401, { message: '请先登录' });
  const body = readBody(event);
  const withName = body && String(body.with || '').trim();
  if (!withName) return json(400, { message: '缺少对话对象' });

  try {
    const rows = await sb('profiles?username=eq.' + encodeURIComponent(withName) + '&select=id,username');
    const other = rows && rows[0];
    if (!other) return json(404, { message: '没有这个用户' });

    const filter = 'or=(and(from_id.eq.' + uid + ',to_id.eq.' + other.id + '),and(from_id.eq.' + other.id + ',to_id.eq.' + uid + '))';
    const msgs = await sb('messages?' + filter + '&order=created_at.asc&limit=200&select=id,from_id,to_id,content,created_at');

    try {
      await sb('messages?from_id=eq.' + other.id + '&to_id=eq.' + uid + '&read_at=is.null', {
        method: 'PATCH',
        body: JSON.stringify({ read_at: new Date().toISOString() })
      });
    } catch (e) {}

    return json(200, { other: { id: other.id, username: other.username }, messages: msgs || [] });
  } catch (err) {
    return json(500, { message: '读取失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 自己的资料（按登录身份取，查不到就补一条） ---------------- */
async function handleUserMe(event) {
  const info = authInfo(event);
  if (!info) return json(401, { message: '请先登录' });
  if (!(await authUid(event))) return json(401, { message: '登录已失效，请重新登录' });

  try {
    let p = null;

    const byId = await sb('profiles?id=eq.' + info.u + '&select=id,username,bio,tags,created_at,exp,streak,last_checkin,tickets');
    p = byId && byId[0];


    if (!p) {
      try {
        const created = await sb('profiles', {
          method: 'POST',
          body: JSON.stringify({
            id: info.u,
            username: info.n || ('用户' + String(info.u).slice(0, 6)),
            pass_hash: '!'
          })
        });
        p = created && created[0];
      } catch (e) {
        try {
          const alt = (info.n || '用户') + '_' + String(info.u).slice(0, 4);
          const created2 = await sb('profiles', {
            method: 'POST',
            body: JSON.stringify({ id: info.u, username: alt, pass_hash: '!' })
          });
          p = created2 && created2[0];
        } catch (e2) {}
      }

      if (!p) {
        const again = await sb('profiles?id=eq.' + info.u + '&select=id,username,bio,tags,created_at,exp,streak,last_checkin,tickets');
        p = again && again[0];
      }
    }

    if (!p) return json(404, { message: '资料还没建好，刷新一次再试' });

    let postCount = 0;
    try {
      const posts = await sb('posts?author_id=eq.' + p.id + '&select=id&limit=1000');
      postCount = (posts || []).length;
    } catch (e) {}

    return json(200, {
      id: p.id, username: p.username, bio: p.bio || '',
      tags: p.tags || [], created_at: p.created_at, postCount: postCount,
      exp: p.exp || 0, streak: p.streak || 0, last_checkin: p.last_checkin || null,
      tickets: p.tickets || 0
    });
  } catch (err) {
    return json(500, { message: '读取失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 吃瓜（服务端原子操作） ---------------- */
async function handleMelon(event) {
  if (!rateLimit('melon:' + clientIp(event), 60, 60000)) {
    return json(429, { message: '点太快了，歇一会儿' });
  }
  const body = readBody(event) || {};
  const id = String(body.post_id || '');
  const uidM = await authUid(event);
  const rawDevM = String(body.device_id || '').trim();
  const dev = uidM ? ('u:' + uidM) : ('d:' + rawDevM.slice(0, 80));
  if (!id || !dev) return json(400, { message: '参数不全' });

  try {
    const ins = await sb('reactions', {
      method: 'POST',
      prefer: 'return=representation,resolution=ignore-duplicates',
      body: JSON.stringify({ post_id: id, device_id: dev, kind: 'melon' })
    });
    const fresh = !!(ins && ins.length);

    if (fresh) {
      try {
        await sb('rpc/add_melon', { method: 'POST', body: JSON.stringify({ p_post_id: id }) });
        try {
          const pr = await sb('posts?id=eq.' + id + '&select=author_id');
          const aid = pr && pr[0] && pr[0].author_id;
          if (aid) await sb('rpc/bump_exp', { method: 'POST', body: JSON.stringify({ p_uid: aid, p_n: 1 }) });
        } catch (e3) {}
      } catch (e) {
        try {
          await sb('reactions?post_id=eq.' + id + '&device_id=eq.' + encodeURIComponent(dev) + '&kind=eq.melon', {
            method: 'DELETE', prefer: 'return=minimal'
          });
        } catch (e2) {}
        return json(500, { message: '计数失败：' + String(e.message).slice(0, 120) });
      }
    }

    let melon = 0;
    try {
      const rows = await sb('posts?id=eq.' + id + '&select=melon');
      melon = (rows && rows[0] && rows[0].melon) || 0;
    } catch (e) {}

    return json(200, { counted: fresh, melon: melon });
  } catch (err) {
    return json(500, { message: '点赞失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 服务端内容校验 ---------------- */
const ALLOWED_CATS = ['news', 'rumor', 'gossip', 'leak', 'debunk', 'help'];
const ALLOWED_CRED = ['confirmed', 'unverified', 'rumor', 'debunked'];
const ALLOWED_REASONS = ['privacy', 'attack', 'rumor', 'nsfw', 'spam', 'other'];

async function handlePostCreate(event) {
  if (!rateLimit('post:' + clientIp(event), 6, 60000)) {
    return json(429, { message: '发帖太频繁，歇一分钟' });
  }

  const body = readBody(event) || {};
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  const cat = String(body.category || 'news');
  const cred = String(body.credibility || 'unverified');
  const alias = (String(body.author_alias || '').trim() || '匿名').slice(0, 20);
  const school = String(body.school || '').trim().slice(0, 40) || null;

  let images = Array.isArray(body.images) ? body.images : [];
  images = images.filter(function (x) {
    return typeof x === 'string' && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+\/]+=*$/.test(x);
  }).slice(0, 3);
  const imgBytes = images.reduce(function (n2, s) { return n2 + s.length; }, 0);
  if (imgBytes > 400000) return json(413, { message: '图片太大了，压缩后再传' });

  if (title.length < 2 || title.length > 40) return json(400, { message: '标题要 2–40 字' });
  if (content.length < 2 || content.length > 1000) return json(400, { message: '正文要 2–1000 字' });
  if (ALLOWED_CATS.indexOf(cat) < 0) return json(400, { message: '分类不对' });
  if (ALLOWED_CRED.indexOf(cred) < 0) return json(400, { message: '可信度不对' });

  const authorId = await authUid(event);
  let authorExp = 0;
  if (authorId) {
    try {
      const pr = await sb('profiles?id=eq.' + authorId + '&select=exp');
      authorExp = (pr && pr[0] && pr[0].exp) || 0;
    } catch (e) {}
  }

  try {
    const rows = await sb('posts', {
      method: 'POST',
      body: JSON.stringify({
        title: title, content: content, category: cat, credibility: cred,
        school: school, tags: [], images: images,
        author_alias: alias, status: 'published', author_id: authorId, author_exp: authorExp
      })
    });
    if (authorId) {
      try { await sb('rpc/bump_exp', { method: 'POST', body: JSON.stringify({ p_uid: authorId, p_n: 10 }) }); } catch (e) {}
      try { await sb('rpc/earn_tickets', { method: 'POST', body: JSON.stringify({ p_uid: authorId, p_kind: 'post', p_amount: 5, p_cap: 15 }) }); } catch (e) {}
    }
    return json(200, (rows && rows[0]) || { ok: true });
  } catch (err) {
    return json(500, { message: '发帖失败：' + String(err.message).slice(0, 120) });
  }
}

async function handleCommentCreate(event) {
  if (!rateLimit('cmt:' + clientIp(event), 20, 60000)) {
    return json(429, { message: '评论太频繁，歇一会儿' });
  }

  const body = readBody(event) || {};
  const postId = String(body.post_id || '').trim();
  const content = String(body.content || '').trim();
  const alias = (String(body.author_alias || '').trim() || '匿名').slice(0, 20);
  const parentId = body.parent_id ? String(body.parent_id).trim() : null;
  const authorId = await authUid(event);
  let authorExp = 0;
  if (authorId) {
    try {
      const pr = await sb('profiles?id=eq.' + authorId + '&select=exp');
      authorExp = (pr && pr[0] && pr[0].exp) || 0;
    } catch (e) {}
  }

  if (!postId) return json(400, { message: '缺少帖子' });
  if (content.length < 1 || content.length > 500) return json(400, { message: '评论要 1–500 字' });

  try {
    const rows = await sb('comments', {
      method: 'POST',
      body: JSON.stringify({ post_id: postId, parent_id: parentId, content: content, author_alias: alias, author_id: authorId })
    });
    if (authorId) {
      try { await sb('rpc/bump_exp', { method: 'POST', body: JSON.stringify({ p_uid: authorId, p_n: 2 }) }); } catch (e) {}
      try { await sb('rpc/earn_tickets', { method: 'POST', body: JSON.stringify({ p_uid: authorId, p_kind: 'comment', p_amount: 1, p_cap: 10 }) }); } catch (e) {}
    }
    return json(200, (rows && rows[0]) || { ok: true });
  } catch (err) {
    return json(500, { message: '评论失败：' + String(err.message).slice(0, 120) });
  }
}

async function handleReportCreate(event) {
  if (!rateLimit('rep:' + clientIp(event), 10, 60000)) {
    return json(429, { message: '举报提交太频繁' });
  }

  const body = readBody(event) || {};
  const type = String(body.target_type || '');
  const target = String(body.target_id || '').trim();
  const reason = String(body.reason || '');
  const detail = String(body.detail || '').slice(0, 200);

  if (type !== 'post' && type !== 'comment') return json(400, { message: '举报对象不对' });
  if (!target) return json(400, { message: '缺少对象 ID' });
  if (ALLOWED_REASONS.indexOf(reason) < 0) return json(400, { message: '举报理由不对' });

  try {
    await sb('reports', {
      method: 'POST',
      body: JSON.stringify({ target_type: type, target_id: target, reason: reason, detail: detail })
    });
    return json(200, { ok: true });
  } catch (err) {
    return json(500, { message: '提交失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 保安 / 管理员 ---------------- */
function makeStaffToken(kind) {
  const payload = Buffer.from(JSON.stringify({ r: kind, x: Date.now() + 2 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', PEPPER).update('staff:' + payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyStaff(event) {
  const tok = String(event.headers['x-staff'] || '').trim();
  if (!tok || tok.indexOf('.') < 0) return null;
  const parts = tok.split('.');
  const expect = crypto.createHmac('sha256', PEPPER).update('staff:' + parts[0]).digest('base64url');
  if (!safeEqual(parts[1], expect)) return null;
  try {
    const o = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (!o.r || !o.x || o.x < Date.now()) return null;
    return o.r;
  } catch (e) { return null; }
}

async function handleStaffLogin(event) {
  if (!rateLimit('staff:' + clientIp(event), 8, 60000)) {
    return json(429, { message: '试得太频繁，等一分钟' });
  }

  const body = readBody(event) || {};
  const kind = String(body.kind || '');
  const code = String(body.code || '');

  if (kind === 'admin') {
    if (!ADMIN_PASSWORD) return json(500, { message: '站点还没配置管理口令' });
    if (!safeEqual(code, ADMIN_PASSWORD)) return json(401, { message: '口令不对' });
    return json(200, { kind: 'admin', token: makeStaffToken('admin') });
  }

  if (kind === 'guard') {
    if (!GUARD_CODE) return json(500, { message: '站点还没配置保安码' });
    if (!safeEqual(code, GUARD_CODE)) return json(401, { message: '保安码不对' });
    return json(200, { kind: 'guard', token: makeStaffToken('guard') });
  }

  return json(400, { message: '类型不对' });
}

async function handlePostDelete(event) {
  const body = readBody(event) || {};
  const id = String(body.id || '').trim();
  if (!id) return json(400, { message: '缺少帖子 ID' });

  const staff = verifyStaff(event);
  const uid = await authUid(event);

  try {
    if (!staff) {
      if (!uid) return json(401, { message: '请先登录' });
      const rows = await sb('posts?id=eq.' + id + '&select=author_id');
      const p = rows && rows[0];
      if (!p) return json(404, { message: '帖子不存在' });
      if (!p.author_id || p.author_id !== uid) return json(403, { message: '只能删除自己的帖子' });
    }
    await sb('posts?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' });
    return json(200, { ok: true });
  } catch (err) {
    return json(500, { message: '删除失败：' + String(err.message).slice(0, 120) });
  }
}

async function handleCommentDelete(event) {
  const body = readBody(event) || {};
  const id = String(body.id || '').trim();
  if (!id) return json(400, { message: '缺少评论 ID' });

  const staff = verifyStaff(event);
  const uid = await authUid(event);

  try {
    if (!staff) {
      if (!uid) return json(401, { message: '请先登录' });
      const rows = await sb('comments?id=eq.' + id + '&select=author_id');
      const cm = rows && rows[0];
      if (!cm) return json(404, { message: '评论不存在' });
      if (!cm.author_id || cm.author_id !== uid) return json(403, { message: '只能删除自己的评论' });
    }
    await sb('comments?or=(id.eq.' + id + ',parent_id.eq.' + id + ')', { method: 'DELETE', prefer: 'return=minimal' });
    return json(200, { ok: true });
  } catch (err) {
    return json(500, { message: '删除失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 站队投票 ---------------- */
async function handleVote(event) {
  if (!rateLimit('vote:' + clientIp(event), 60, 60000)) {
    return json(429, { message: '点太快了' });
  }

  const body = readBody(event) || {};
  const postId = String(body.post_id || '').trim();
  const choice = String(body.choice || '');
  const uidV = await authUid(event);
  const rawDev = String(body.device_id || '').trim();
  const dev = uidV ? ('u:' + uidV) : ('d:' + rawDev.slice(0, 80));

  if (!postId || !dev) return json(400, { message: '参数不全' });
  if (['believe', 'doubt', 'unsure'].indexOf(choice) < 0) return json(400, { message: '选项不对' });

  try {
    const ins = await sb('votes', {
      method: 'POST',
      prefer: 'return=representation,resolution=ignore-duplicates',
      body: JSON.stringify({ post_id: postId, device_id: dev, choice: choice })
    });

    if (ins && ins.length) {
      try { await sb('rpc/bump_vote', { method: 'POST', body: JSON.stringify({ p_post_id: postId, p_choice: choice }) }); } catch (e) {}
    }

    const rows = await sb('posts?id=eq.' + postId + '&select=vote_believe,vote_doubt,vote_unsure');
    const p = (rows && rows[0]) || {};
    return json(200, {
      counted: !!(ins && ins.length),
      believe: p.vote_believe || 0,
      doubt: p.vote_doubt || 0,
      unsure: p.vote_unsure || 0
    });
  } catch (err) {
    return json(500, { message: '投票失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 求锤 ---------------- */
async function handleEvidence(event) {
  if (!rateLimit('ev:' + clientIp(event), 30, 60000)) {
    return json(429, { message: '点太快了' });
  }

  const body = readBody(event) || {};
  const postId = String(body.post_id || '').trim();
  const uidV = await authUid(event);
  const rawDev = String(body.device_id || '').trim();
  const dev = uidV ? ('u:' + uidV) : ('d:' + rawDev.slice(0, 80));
  if (!postId || !dev) return json(400, { message: '参数不全' });

  try {
    const ins = await sb('evidence_votes', {
      method: 'POST',
      prefer: 'return=representation,resolution=ignore-duplicates',
      body: JSON.stringify({ post_id: postId, device_id: dev })
    });

    if (ins && ins.length) {
      try { await sb('rpc/bump_evidence', { method: 'POST', body: JSON.stringify({ p_post_id: postId }) }); } catch (e) {}
    }

    const rows = await sb('posts?id=eq.' + postId + '&select=evidence_count');
    return json(200, { counted: !!(ins && ins.length), count: (rows && rows[0] && rows[0].evidence_count) || 0 });
  } catch (err) {
    return json(500, { message: '操作失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 后续更新 ---------------- */
async function handleUpdateAdd(event) {
  if (!rateLimit('upd:' + clientIp(event), 10, 60000)) {
    return json(429, { message: '补充太频繁' });
  }

  const body = readBody(event) || {};
  const postId = String(body.post_id || '').trim();
  const content = String(body.content || '').trim();
  const info = verifyToken(bearer(event));
  const alias = (info && info.n) ? info.n : (String(body.author_alias || '匿名').slice(0, 20));

  if (!postId) return json(400, { message: '缺少帖子' });
  if (content.length < 2 || content.length > 300) return json(400, { message: '补充要 2–300 字' });

  try {
    await sb('rpc/append_update', {
      method: 'POST',
      body: JSON.stringify({ p_post_id: postId, p_text: content, p_alias: alias })
    });
    return json(200, { ok: true });
  } catch (err) {
    return json(500, { message: '提交失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 签到 ---------------- */
async function handleCheckin(event) {
  const uid = await authUid(event);
  if (!uid) return json(401, { message: '请先登录' });

  try {
    const rows = await sb('rpc/do_checkin', { method: 'POST', body: JSON.stringify({ p_uid: uid }) });
    const r = Array.isArray(rows) ? rows[0] : rows;
    return json(200, r || { ok: true });
  } catch (err) {
    return json(500, { message: '签到失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 等级榜 ---------------- */
async function handleLeaderboard(event) {
  if (!rateLimit('lb:' + clientIp(event), 30, 60000)) {
    return json(429, { message: '刷太快了' });
  }
  try {
    const rows = await sb('profiles?select=username,exp&order=exp.desc&limit=10');
    return json(200, (rows || []).map(function (r) {
      return { username: r.username, exp: r.exp || 0 };
    }));
  } catch (err) {
    return json(500, { message: '读取失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 瓜票：加辣 ---------------- */
async function handleBoost(event) {
  const uid = await authUid(event);
  if (!uid) return json(401, { message: '请先登录' });

  if (!rateLimit('boost:' + clientIp(event), 20, 60000)) {
    return json(429, { message: '点太快了' });
  }

  const body = readBody(event) || {};
  const postId = String(body.post_id || '').trim();
  if (!postId) return json(400, { message: '缺少帖子' });

  try {
    const exist = await sb('posts?id=eq.' + postId + '&select=id');
    if (!exist || !exist.length) return json(404, { message: '帖子不存在' });

    const rows = await sb('rpc/do_boost', {
      method: 'POST',
      body: JSON.stringify({ p_uid: uid, p_post: postId })
    });
    const r = Array.isArray(rows) ? rows[0] : rows;

    if (!r || !r.ok) {
      if (r && r.reason === 'no_tickets') {
        return json(400, { message: '瓜票不够，还差 ' + (5 - (r.tickets || 0)) + ' 张' });
      }
      if (r && r.reason === 'already') {
        return json(409, { message: '这个帖子你今天已经加过辣了' });
      }
      return json(400, { message: '加辣失败' });
    }

    return json(200, { score: r.score, until: r.until, tickets: r.tickets });
  } catch (err) {
    return json(500, { message: '加辣失败：' + String(err.message).slice(0, 120) });
  }
}
