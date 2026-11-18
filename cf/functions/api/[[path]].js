/**
 * Cloudflare Pages Function
 * 路径：functions/api/[[path]].js → 匹配 /api/*
 *
 * 浏览器 → https://smicmc.qd.je/api/rest/v1/posts
 *        → 本函数（跑在 Cloudflare 边缘）
 *        → https://uadpbsgfithscrknqjnu.supabase.co/rest/v1/posts
 */

const SUPABASE = 'https://uadpbsgfithscrknqjnu.supabase.co';
const ANON_KEY = 'sb_publishable_Eu-_IB5Uigc8BZrl6DZb5w_zwPvkjm3';

const TOKEN_TTL = 30 * 24 * 3600 * 1000;

/* ---------------- 基础工具 ---------------- */
function json(code, obj) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function b64url(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

async function hmacHex(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacB64(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  let bin = '';
  new Uint8Array(sig).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pepper(env) {
  return env.AUTH_SECRET || env.ADMIN_PASSWORD || 'gua-default-pepper';
}

async function hashPass(env, username, password) {
  return hmacHex(pepper(env), String(username).toLowerCase() + '\u0000' + password);
}

async function makeToken(env, uid) {
  const payload = b64url(JSON.stringify({ u: uid, x: Date.now() + TOKEN_TTL }));
  const sig = await hmacB64(pepper(env), payload);
  return payload + '.' + sig;
}

async function verifyToken(env, tok) {
  if (!tok || String(tok).indexOf('.') < 0) return null;
  const parts = String(tok).split('.');
  const expect = await hmacB64(pepper(env), parts[0]);
  if (parts[1] !== expect) return null;
  try {
    const o = JSON.parse(unb64url(parts[0]));
    if (!o.u || !o.x || o.x < Date.now()) return null;
    return o.u;
  } catch (e) { return null; }
}

function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.replace(/^Bearer\s+/i, '').trim();
}

async function authUid(env, request) {
  return verifyToken(env, bearer(request));
}

/* ---------------- Supabase REST ---------------- */
async function sb(env, path, opts) {
  const o = opts || {};
  const key = env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('未配置 SUPABASE_SERVICE_KEY');

  const res = await fetch(SUPABASE + '/rest/v1/' + path, {
    method: o.method || 'GET',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: o.prefer || 'return=representation'
    },
    body: o.body
  });
  const text = await res.text();
  if (!res.ok) throw new Error('DB ' + res.status + ': ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

/* ---------------- 代理 ---------------- */
async function proxy(env, path, search, method, body, headers) {
  const target = SUPABASE + path + (search || '');

  const adminHeader = headers.get('x-admin-key') || '';
  let isAdmin = false;

  if (adminHeader) {
    if (adminHeader !== env.ADMIN_PASSWORD) return json(403, { message: '管理口令不正确' });
    if (!env.SUPABASE_SERVICE_KEY) return json(500, { message: '还没配置 SUPABASE_SERVICE_KEY' });
    isAdmin = true;
  }

  const key = isAdmin ? env.SUPABASE_SERVICE_KEY : ANON_KEY;
  const h = {
    apikey: key,
    'Content-Type': 'application/json'
  };
  const auth = headers.get('authorization');
  h.Authorization = isAdmin ? 'Bearer ' + key : (auth || 'Bearer ' + ANON_KEY);
  if (headers.get('prefer')) h.Prefer = headers.get('prefer');

  try {
    const res = await fetch(target, { method: method, headers: h, body: body || undefined });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return json(502, { message: '代理请求失败：' + err.message });
  }
}

/* ---------------- 账号 ---------------- */
async function handleAuth(env, isRegister, method, rawBody) {
  if (method !== 'POST') return json(405, { message: '只支持 POST' });
  if (!env.SUPABASE_SERVICE_KEY) return json(500, { message: '站点还没配置 SUPABASE_SERVICE_KEY' });

  let body;
  try { body = JSON.parse(rawBody || '{}'); } catch (e) { return json(400, { message: '请求格式不对' }); }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (username.length < 2 || username.length > 16) return json(400, { message: '用户名要 2–16 个字' });
  if (password.length < 6) return json(400, { message: '密码至少 6 位' });
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_.-]+$/.test(username)) return json(400, { message: '用户名只能用中文、字母、数字、下划线' });

  try {
    const rows = await sb(env, 'profiles?username=eq.' + encodeURIComponent(username) + '&select=id,username,pass_hash');
    const exist = rows && rows[0];

    if (isRegister) {
      if (exist) return json(409, { message: '这个用户名已经有人用了' });
      const hash = await hashPass(env, username, password);
      const created = await sb(env, 'profiles', {
        method: 'POST',
        body: JSON.stringify({ username: username, pass_hash: hash })
      });
      const row = created && created[0];
      if (!row) return json(500, { message: '注册失败，请重试' });
      return json(200, { id: row.id, username: row.username, token: await makeToken(env, row.id) });
    }

    if (!exist) return json(401, { message: '用户名或密码不对' });
    const hash = await hashPass(env, username, password);
    if (exist.pass_hash !== hash) return json(401, { message: '用户名或密码不对' });
    return json(200, { id: exist.id, username: exist.username, token: await makeToken(env, exist.id) });
  } catch (err) {
    const msg = String(err.message || '');
    if (msg.indexOf('duplicate') >= 0 || msg.indexOf('23505') >= 0) return json(409, { message: '这个用户名已经有人用了' });
    if (msg.indexOf('42P01') >= 0 || msg.indexOf('does not exist') >= 0) return json(500, { message: '还没建 profiles 表' });
    return json(500, { message: '服务器错误：' + msg.slice(0, 120) });
  }
}

/* ---------------- 个人空间 ---------------- */
async function handleUserGet(env, rawBody) {
  let body;
  try { body = JSON.parse(rawBody || '{}'); } catch (e) { return json(400, { message: '请求格式不对' }); }
  if (!body || !body.username) return json(400, { message: '缺少用户名' });

  try {
    const rows = await sb(env, 'profiles?username=eq.' + encodeURIComponent(body.username) + '&select=id,username,bio,tags,created_at');
    const p = rows && rows[0];
    if (!p) return json(404, { message: '没有这个用户' });

    let postCount = 0;
    try {
      const posts = await sb(env, 'posts?author_id=eq.' + p.id + '&select=id&limit=1000');
      postCount = (posts || []).length;
    } catch (e) {}

    return json(200, {
      id: p.id, username: p.username, bio: p.bio || '',
      tags: p.tags || [], created_at: p.created_at, postCount: postCount
    });
  } catch (err) {
    return json(500, { message: '查询失败：' + String(err.message).slice(0, 120) });
  }
}

async function handleUserUpdate(env, request, rawBody) {
  const uid = await authUid(env, request);
  if (!uid) return json(401, { message: '请先登录' });

  let body;
  try { body = JSON.parse(rawBody || '{}'); } catch (e) { return json(400, { message: '请求格式不对' }); }

  const bio = String(body.bio || '').slice(0, 120);
  let tags = Array.isArray(body.tags) ? body.tags : [];
  tags = tags.map(t => String(t).trim().slice(0, 10)).filter(Boolean).slice(0, 6);

  try {
    await sb(env, 'profiles?id=eq.' + uid, {
      method: 'PATCH',
      body: JSON.stringify({ bio: bio, tags: tags })
    });
    return json(200, { ok: true, bio: bio, tags: tags });
  } catch (err) {
    return json(500, { message: '保存失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 私信 ---------------- */
async function handleMsgSend(env, request, rawBody) {
  const uid = await authUid(env, request);
  if (!uid) return json(401, { message: '请先登录' });

  let body;
  try { body = JSON.parse(rawBody || '{}'); } catch (e) { return json(400, { message: '请求格式不对' }); }

  const to = String(body.to || '').trim();
  const content = String(body.content || '').trim();
  if (!to) return json(400, { message: '缺少收件人' });
  if (!content) return json(400, { message: '内容不能为空' });
  if (content.length > 500) return json(400, { message: '消息最多 500 字' });

  try {
    const rows = await sb(env, 'profiles?username=eq.' + encodeURIComponent(to) + '&select=id,username');
    const target = rows && rows[0];
    if (!target) return json(404, { message: '没有这个用户' });
    if (target.id === uid) return json(400, { message: '不能给自己发私信' });

    const created = await sb(env, 'messages', {
      method: 'POST',
      body: JSON.stringify({ from_id: uid, to_id: target.id, content: content })
    });
    return json(200, (created && created[0]) || { ok: true });
  } catch (err) {
    return json(500, { message: '发送失败：' + String(err.message).slice(0, 120) });
  }
}

async function handleMsgInbox(env, request) {
  const uid = await authUid(env, request);
  if (!uid) return json(401, { message: '请先登录' });

  try {
    const rows = await sb(env, 'messages?or=(from_id.eq.' + uid + ',to_id.eq.' + uid +
      ')&order=created_at.desc&limit=200&select=id,from_id,to_id,content,created_at,read_at');
    const list = rows || [];
    const others = {};
    list.forEach(function (m) {
      const other = m.from_id === uid ? m.to_id : m.from_id;
      if (!others[other]) others[other] = { id: other, last: m.content, lastAt: m.created_at, unread: 0 };
      if (m.to_id === uid && !m.read_at) others[other].unread++;
    });
    const ids = Object.keys(others);
    if (ids.length) {
      const profs = await sb(env, 'profiles?id=in.(' + ids.join(',') + ')&select=id,username');
      (profs || []).forEach(function (p) { if (others[p.id]) others[p.id].username = p.username; });
    }
    const arr = Object.values(others).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    return json(200, arr);
  } catch (err) {
    return json(500, { message: '读取失败：' + String(err.message).slice(0, 120) });
  }
}

async function handleMsgThread(env, request, rawBody) {
  const uid = await authUid(env, request);
  if (!uid) return json(401, { message: '请先登录' });

  let body;
  try { body = JSON.parse(rawBody || '{}'); } catch (e) { return json(400, { message: '请求格式不对' }); }
  const withName = String(body.with || '').trim();
  if (!withName) return json(400, { message: '缺少对话对象' });

  try {
    const rows = await sb(env, 'profiles?username=eq.' + encodeURIComponent(withName) + '&select=id,username');
    const other = rows && rows[0];
    if (!other) return json(404, { message: '没有这个用户' });

    const filter = 'or=(and(from_id.eq.' + uid + ',to_id.eq.' + other.id + '),and(from_id.eq.' + other.id + ',to_id.eq.' + uid + '))';
    const msgs = await sb(env, 'messages?' + filter + '&order=created_at.asc&limit=200&select=id,from_id,to_id,content,created_at');

    try {
      await sb(env, 'messages?from_id=eq.' + other.id + '&to_id=eq.' + uid + '&read_at=is.null', {
        method: 'PATCH',
        body: JSON.stringify({ read_at: new Date().toISOString() })
      });
    } catch (e) {}

    return json(200, { other: { id: other.id, username: other.username }, messages: msgs || [] });
  } catch (err) {
    return json(500, { message: '读取失败：' + String(err.message).slice(0, 120) });
  }
}

/* ---------------- 入口 ---------------- */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  let path = url.pathname.replace(/^\/api/, '');
  if (!path) path = '/';

  const method = request.method;
  const rawBody = (method === 'GET' || method === 'HEAD') ? null : await request.text();

  if (path === '/auth/register') return handleAuth(env, true, method, rawBody);
  if (path === '/auth/login') return handleAuth(env, false, method, rawBody);
  if (path === '/user/get') return handleUserGet(env, rawBody);
  if (path === '/user/update') return handleUserUpdate(env, request, rawBody);
  if (path === '/msg/send') return handleMsgSend(env, request, rawBody);
  if (path === '/msg/inbox') return handleMsgInbox(env, request);
  if (path === '/msg/thread') return handleMsgThread(env, request, rawBody);

  return proxy(env, path, url.search, method, rawBody, request.headers);
}
