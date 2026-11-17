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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'gua2026';
// 管理员密钥：Netlify 环境变量 SUPABASE_SERVICE_KEY（不要把 service key 写进代码）
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

exports.handler = async function (event) {
  // 兼容两种路径：/api/xxx 和 /.netlify/functions/api/xxx
  let path = event.path || '/';
  path = path.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '');
  if (!path) path = '/';

  /* 用户名 + 密码账号：不经过 Supabase Auth，不发任何邮件 */
  if (path === '/auth/register' || path === '/auth/login') {
    return handleAuth(path === '/auth/register', event);
  }

  const qs = event.rawQuery ? '?' + event.rawQuery : '';
  const target = SUPABASE + path + qs;

  // 管理员请求：带对口令就走 service key（绕过 RLS），否则用公开 key
  const adminHeader = event.headers['x-admin-key'] || '';
  if (adminHeader) {
    if (adminHeader !== ADMIN_PASSWORD) {
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

const PEPPER = process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || 'gua-default-pepper';

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
      Prefer: 'return=representation'
    },
    body: o.body
  });
  const text = await res.text();
  if (!res.ok) throw new Error('DB ' + res.status + ': ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

async function handleAuth(isRegister, event) {
  if ((event.httpMethod || 'GET') !== 'POST') return json(405, { message: '只支持 POST' });
  if (!SERVICE_KEY) return json(500, { message: '站点还没配置 SUPABASE_SERVICE_KEY' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { message: '请求格式不对' }); }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (username.length < 2 || username.length > 16) return json(400, { message: '用户名要 2–16 个字' });
  if (password.length < 6) return json(400, { message: '密码至少 6 位' });
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_.-]+$/.test(username)) return json(400, { message: '用户名只能用中文、字母、数字、下划线' });

  try {
    const rows = await sb('profiles?username=eq.' + encodeURIComponent(username) + '&select=id,username,pass_hash');
    const exist = rows && rows[0];

    if (isRegister) {
      if (exist) return json(409, { message: '这个用户名已经有人用了' });
      const created = await sb('profiles', {
        method: 'POST',
        body: JSON.stringify({ username: username, pass_hash: hashPass(username, password) })
      });
      const row = created && created[0];
      if (!row) return json(500, { message: '注册失败，请重试' });
      return json(200, { id: row.id, username: row.username });
    }

    if (!exist) return json(401, { message: '用户名或密码不对' });
    if (exist.pass_hash !== hashPass(username, password)) return json(401, { message: '用户名或密码不对' });
    return json(200, { id: exist.id, username: exist.username });
  } catch (err) {
    const msg = String(err.message || '');
    if (msg.indexOf('duplicate') >= 0 || msg.indexOf('23505') >= 0) {
      return json(409, { message: '这个用户名已经有人用了' });
    }
    if (msg.indexOf('42P01') >= 0 || msg.indexOf('does not exist') >= 0) {
      return json(500, { message: '还没建 profiles 表，请先在 Supabase 跑建表 SQL' });
    }
    return json(500, { message: '服务器错误：' + msg.slice(0, 120) });
  }
}
