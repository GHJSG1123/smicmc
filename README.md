# 校园瓜田 · 同域代理版

## 为什么又要改

之前的版本，浏览器直接访问 `supabase.co`，国内连不上，所以页面能开、数据出不来。

这一版把数据请求改成走**你自己的域名**：

```
浏览器  →  smicmc.qd.je/api/rest/v1/posts
        →  Netlify 函数（服务器在海外，能连 Supabase）
        →  uadpbsgfithsrkngjnu.supabase.co
```

浏览器全程只跟 `smicmc.qd.je` 通信，这条路你已经验证过是通的。
顺便，数据库密钥也不再出现在前端代码里。

---

## 部署（只需做一次）

### 第 1 步：注册 GitHub

<https://github.com/signup> —— 邮箱、密码、验证一下，1 分钟。

### 第 2 步：建仓库并上传文件

1. 打开 <https://github.com/new>
2. Repository name 填 `smicmc`，选 **Public**，点 **Create repository**
3. 在新仓库页面点 **uploading an existing file**（或 `Add file → Upload files`）
4. **把解压后文件夹里的所有东西拖进去**（要包含 `netlify.toml`、`public/`、`netlify/`）
   - 拖整个文件夹是可以的，GitHub 会保留目录结构
   - 确认上传列表里能看到 `netlify/functions/api.js` 这个路径
5. 点 **Commit changes**

### 第 3 步：Netlify 连接这个仓库

1. Netlify → **Add new site → Import an existing project**
2. 选 **GitHub**，授权，选中 `smicmc` 仓库
3. 构建设置**什么都不用改**（`netlify.toml` 已经写好了）
4. 点 **Deploy**

部署完，Netlify 会给一个新的 `xxx.netlify.app` 地址。先打开它确认页面正常、数据能出来。

### 第 4 步：把域名指过来

1. 新站点的 **Domain management → Add a domain** → 输入 `smicmc.qd.je`
2. 它提示域名已被别的站点占用 → 回**旧站点**（拖拽部署的那个）→ Domain management → 把 `smicmc.qd.je` **Remove**
3. 再回新站点重新 Add 一次
4. 等 1–5 分钟，证书会自动签好

---

## 验证

打开 `https://smicmc.qd.je`：

- 首页显示「瓜田还没开张」→ 正常，点**填入 8 条示例**
- 出现 8 条帖子 → 数据链路通了
- 用手机打开同一个地址 → 应该看到同样的 8 条

出问题的话，页面顶部有红条，点里面的测试链接：

| 看到什么 | 说明 |
|---|---|
| `[]` 或一段 JSON | 函数正常，问题在别处 |
| `Page not found` | 函数没部署，检查 `netlify/functions/api.js` 是否上传成功 |
| `代理请求失败` | 函数跑起来了，但服务器连不上 Supabase（很少见） |

---

## 文件结构

```
netlify.toml            构建配置 + /api 转发规则
public/index.html       页面
public/styles.css       样式
public/app.js           逻辑（请求路径改成 /api/...）
netlify/functions/api.js  反向代理函数
```

---

## 没做的

- **审核后台**：发帖即公开
- **图片上传**
- 举报进了 `reports` 表，但没有处理界面

这三个是正式运营前该补的，但先让站跑起来。
