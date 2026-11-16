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
