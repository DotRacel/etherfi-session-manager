// ==UserScript==
// @name         ether.fi 设备会话管理工具
// @namespace    https://www.ether.fi/
// @version      1.2.1
// @description  列出 ether.fi Cash 的所有登录会话，支持选中/全选并注销（登出其它设备）。使用站点自身的内部接口 GET /v2/sessions 与 DELETE /v2/sessions/{id}；接口不返回 area 时，可选用公共 IP 库补全归属地。
// @author       DotRacel
// @icon         https://www.ether.fi/images/favicon/android-chrome-192x192.png
// @icon64       https://www.ether.fi/images/favicon/android-chrome-512x512.png
// @homepageURL  https://github.com/DotRacel/etherfi-session-manager
// @supportURL   https://github.com/DotRacel/etherfi-session-manager/issues
// @updateURL    https://raw.githubusercontent.com/DotRacel/etherfi-session-manager/main/etherfi-session-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/DotRacel/etherfi-session-manager/main/etherfi-session-manager.user.js
// @match        https://www.ether.fi/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---- API 常量（与前端一致：baseURL=/app/cash/api，cookie 会话，X-Active-User 头）----
  const API_BASE = '/app/cash/api';
  const LIST_PATH = '/v2/sessions';
  const DEL_PATH = (id) => `/v2/sessions/${encodeURIComponent(id)}`;

  function activeUser() {
    try { return localStorage.getItem('active_user') || ''; } catch { return ''; }
  }

  async function apiFetch(path, opts = {}) {
    const headers = Object.assign(
      { 'Content-Type': 'application/json', 'X-Active-User': activeUser() },
      opts.headers || {}
    );
    return fetch(API_BASE + path, {
      credentials: 'include',
      ...opts,
      headers,
    });
  }

  async function listSessions() {
    const r = await apiFetch(LIST_PATH, { method: 'GET' });
    let body = null;
    try { body = await r.json(); } catch { /* non-JSON */ }
    if (!r.ok) {
      const msg = r.status === 401
        ? '未登录 / 会话已失效（401）。请先在本浏览器登录 ether.fi Cash 再试。'
        : `列出会话失败：HTTP ${r.status}`;
      throw new Error(msg + (body ? ' — ' + JSON.stringify(body) : ''));
    }
    return body;
  }

  async function revokeSession(id) {
    const r = await apiFetch(DEL_PATH(id), { method: 'DELETE' });
    let body = null;
    try { body = await r.clone().json(); } catch { /* 可能 204 无 body */ }
    return { ok: r.ok, status: r.status, body };
  }

  // ---- 数据解析（返回结构未知，尽量兜底）----
  function extractList(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      for (const k of ['sessions', 'data', 'items', 'results', 'list', 'rows']) {
        if (Array.isArray(data[k])) return data[k];
      }
      if (data.data && Array.isArray(data.data.sessions)) return data.data.sessions;
      if (data.data && Array.isArray(data.data.items)) return data.data.items;
    }
    return [];
  }

  function getId(s) {
    for (const k of ['id', 'sessionId', 'sessionKey', 'sessionKeyId', 'session_id', 'uuid', 'key', '_id']) {
      if (s && s[k] != null && typeof s[k] !== 'object') return String(s[k]);
    }
    return null;
  }

  function isCurrent(s) {
    for (const k of ['isCurrent', 'current', 'isCurrentSession', 'isThisDevice', 'thisDevice', 'self', 'isMe']) {
      if (s && s[k] === true) return true;
    }
    return false;
  }

  function pick(s, keys) {
    for (const k of keys) if (s && s[k] != null && s[k] !== '') return { key: k, val: s[k] };
    return null;
  }

  function fmtVal(v) {
    if (v == null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    const str = String(v);
    // 看起来像时间戳/日期就格式化
    if (/^\d{10}$/.test(str)) return new Date(Number(str) * 1000).toLocaleString();
    if (/^\d{13}$/.test(str)) return new Date(Number(str)).toLocaleString();
    if (/^\d{4}-\d{2}-\d{2}T/.test(str)) { const d = new Date(str); if (!isNaN(d)) return d.toLocaleString(); }
    return str;
  }

  const F_DEVICE = ['deviceName', 'device', 'deviceType', 'deviceModel'];
  const F_OS = ['os', 'operatingSystem', 'platform'];
  const F_BROWSER = ['browser', 'client', 'userAgent', 'ua'];

  // deviceType / sessionType 是英文枚举，转成中文再展示
  const TYPE_ZH = {
    desktop: '桌面设备', mobile: '移动设备', tablet: '平板设备', laptop: '笔记本',
    web: '网页', browser: '浏览器', app: 'App', ios: 'iOS', android: 'Android',
  };
  const zh = (v) => TYPE_ZH[String(v).toLowerCase()] || String(v);

  // 卡片标题：设备名 > 浏览器 > 系统
  function deviceTitle(s) {
    const hit = pick(s, F_DEVICE) || pick(s, F_BROWSER) || pick(s, F_OS);
    return hit ? fmtVal(hit.val) : '未知设备';
  }

  // 副标题：系统 · 浏览器 · 设备类型 · 会话类型（去掉已被标题占用的）
  function deviceSub(s) {
    const used = deviceTitle(s);
    const parts = [pick(s, F_OS), pick(s, F_BROWSER), pick(s, ['deviceType']), pick(s, ['sessionType'])]
      .filter(Boolean).map((h) => fmtVal(h.val))
      .filter((v) => v && v !== used)
      .map(zh);
    return [...new Set(parts)].join(' · ');
  }

  function deviceKind(s) {
    const blob = [...F_DEVICE, ...F_OS, ...F_BROWSER, 'sessionType']
      .map((k) => (s && s[k] != null && typeof s[k] !== 'object') ? String(s[k]) : '')
      .join(' ').toLowerCase();
    if (/iphone|ipad|android|phone|mobile|ios|tablet/.test(blob)) return 'phone';
    if (/mac|windows|win32|linux|desktop|laptop|pc|ubuntu|cros/.test(blob)) return 'laptop';
    return 'globe';
  }

  // 明细行（不含已在卡头展示的设备/系统/浏览器）
  // 值为 { geo: ip } 时表示“待用 IP 库查询归属地”
  function summarizeMeta(s) {
    const rows = [];
    const add = (label, hit) => { if (hit) rows.push([label, fmtVal(hit.val)]); };
    const ip = pick(s, ['ipAddress', 'ip', 'ipAddr', 'remoteIp']);
    add('IP', ip);
    const loc = pick(s, ['area', 'location', 'city', 'region', 'country', 'geo']);
    if (loc) rows.push(['位置', fmtVal(loc.val)]);
    else if (ip) rows.push(['位置', { geo: String(ip.val) }]);
    add('创建于', pick(s, ['createdAt', 'created', 'creationTime', 'loginAt', 'createdTime', 'issuedAt']));
    add('最近活动', pick(s, ['lastActiveAt', 'lastActive', 'lastUsedAt', 'lastSeenAt', 'updatedAt', 'lastUsed']));
    add('过期于', pick(s, ['expiresAt', 'expiry', 'expireAt', 'expiresAtDate', 'exp']));
    return rows;
  }

  // ---- IP 归属地（接口的 area 通常为 null，用公共 IP 库补）----
  // 两家都是 HTTPS + Access-Control-Allow-Origin:* + 免密钥，按顺序降级。
  // 请求一律 credentials:'omit'，不会把 ether.fi 的 cookie 带给第三方。
  const GEO_PROVIDERS = [
    {
      name: 'ipwho.is',
      url: (ip) => `https://ipwho.is/${encodeURIComponent(ip)}`,
      parse: (d) => (d && d.success !== false && d.country)
        ? { cc: d.country_code, parts: [d.city, d.region, d.country] } : null,
    },
    {
      name: 'geojs.io',
      url: (ip) => `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`,
      parse: (d) => (d && d.country)
        ? { cc: d.country_code, parts: [d.city, d.region, d.country] } : null,
    },
  ];

  const LS_GEO_CACHE = 'efi_sm_geo_cache';
  const GEO_TTL = 7 * 24 * 60 * 60 * 1000;
  let geoToken = 0;

  function readGeoCache() {
    try {
      const o = JSON.parse(localStorage.getItem(LS_GEO_CACHE) || '{}');
      return (o && typeof o === 'object') ? o : {};
    } catch { return {}; }
  }
  function geoFromCache(ip) {
    const e = readGeoCache()[ip];
    return (e && Date.now() - (e.ts || 0) < GEO_TTL) ? e : null;
  }
  function geoToCache(ip, e) {
    try {
      const c = readGeoCache();
      for (const k of Object.keys(c)) if (Date.now() - (c[k].ts || 0) > GEO_TTL) delete c[k];
      c[ip] = { ...e, ts: Date.now() };
      localStorage.setItem(LS_GEO_CACHE, JSON.stringify(c));
    } catch { /* 忽略 */ }
  }

  function flagEmoji(cc) {
    if (!/^[A-Za-z]{2}$/.test(cc || '')) return '';
    return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
  }

  async function fetchJson(url, ms) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { signal: ac.signal, credentials: 'omit', cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }

  async function lookupGeo(ip) {
    for (const p of GEO_PROVIDERS) {
      const got = p.parse(await fetchJson(p.url(ip), 7000));
      const parts = got ? [...new Set(got.parts.filter(Boolean).map(String))] : [];
      if (parts.length) {
        const e = { text: parts.join(' · '), cc: String(got.cc || '').toUpperCase(), src: p.name };
        geoToCache(ip, e);
        return e;
      }
    }
    return null;
  }

  function shortId(id) {
    return id.length > 22 ? id.slice(0, 10) + '…' + id.slice(-8) : id;
  }

  // ---- 图标（ether.fi 徽标取自站点 /assets/etherfi-logo.svg）----
  const SW = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  const ICON = {
    mark: `<svg class="mark" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.7693 0.0108601L18.3716 1.16473C18.5082 1.19946 18.6182 1.30734 18.6523 1.44623L19.8437 6.16894C19.8664 6.25378 19.8552 6.34262 19.8211 6.41974C19.8021 6.47757 19.7752 6.53548 19.7297 6.58175L11.967 14.4756L15.9207 15.4675C16.0572 15.5022 16.1673 15.6101 16.2014 15.749L17.2297 19.8312L24.9962 11.9331C25.0796 11.8483 25.1933 11.8134 25.3033 11.8249C25.3374 11.8249 25.3756 11.829 25.4097 11.8368L30.012 12.9902C30.1485 13.0249 30.2587 13.1333 30.2928 13.2721L31.4841 17.9944L31.4879 17.9906C31.5106 18.0755 31.4989 18.1642 31.4648 18.2414C31.4458 18.2992 31.4194 18.3571 31.3739 18.4034L18.121 31.8805C18.0452 31.9575 17.9468 31.9962 17.8482 31.9962H17.8402C17.829 31.9963 17.8214 32 17.8139 32C17.7798 32 17.742 31.996 17.7079 31.9844L13.2003 30.669C13.0751 30.6343 12.9763 30.5338 12.9384 30.4026L11.698 26.0044L7.37275 24.7428C7.24756 24.7081 7.14879 24.6076 7.11084 24.4764L5.87383 20.0971L1.56407 18.8393C1.43894 18.8046 1.34015 18.7045 1.30216 18.5734L0.016158 14.0089C-0.0217827 13.8816 0.00852968 13.7503 0.0919991 13.65C0.106531 13.6315 0.127892 13.5954 0.129684 13.5924L13.3788 0.126578C13.394 0.107389 13.4206 0.0994653 13.4396 0.0840694C13.4622 0.0687051 13.481 0.0530924 13.5036 0.0415608H13.5079C13.5874 0.00309503 13.6784 -0.0122168 13.7693 0.0108601ZM14.0454 30.1022L17.2787 31.0469L16.4289 27.6788L14.0454 30.1022ZM17.0587 27.0345L18.0263 30.8735L24.6202 24.1676L20.9365 23.0911L17.0587 27.0345ZM13.4999 29.5501L15.9018 27.1077L12.5752 26.2746L13.4999 29.5501ZM12.7641 25.5141L16.5354 26.4597L20.3939 22.5357L19.3467 18.82L12.7641 25.5141ZM7.79011 24.0556L11.4474 25.1245L10.4799 21.2855L6.74294 20.3479L7.79011 24.0556ZM11.2275 21.1041L12.195 24.9431L16.3079 20.7607L12.6237 19.6843L11.2275 21.1041ZM21.5588 22.4545L24.795 23.4L23.9452 20.0315V20.0277L21.5588 22.4545ZM24.575 19.391L25.5426 23.23L25.5464 23.2338L30.4025 18.2914L26.7184 17.215L24.575 19.391ZM21.0161 21.9066V21.9028L23.4176 19.4604L20.0905 18.6273L21.0161 21.9066ZM6.93654 19.588L10.7074 20.5331L12.0848 19.1326L11.0376 15.4169L6.93654 19.588ZM13.246 19.0514L16.4822 19.997V19.9932L15.6324 16.6246L13.246 19.0514ZM2.40633 18.2721L2.4101 18.2683L5.64253 19.2139L4.79274 15.8453L2.40633 18.2721ZM5.42632 15.1973L6.39388 19.0325L13.0222 12.2921L9.33802 11.2194L5.42632 15.1973ZM20.2836 17.8711L24.055 18.8162L26.1762 16.6596L25.129 12.9439L20.2836 17.8711ZM12.7033 18.4997V18.496L15.1048 16.0536L11.7777 15.2204L12.7033 18.4997ZM1.86367 17.7166L4.26515 15.2743L0.93897 14.4411L1.86367 17.7166ZM26.9157 16.4551L30.5735 17.5239L29.606 13.6849L25.8686 12.7474L26.9157 16.4551ZM1.1274 13.6807L4.89873 14.6263L8.79159 10.6678L7.74442 6.95204L1.1274 13.6807ZM9.9603 10.5865L13.1927 11.5316L12.3429 8.16354L9.9603 10.5865ZM12.9727 7.52307L13.9403 11.3583L18.7663 6.45044L15.0822 5.37781L12.9727 7.52307ZM9.41386 10.0386V10.0349L11.8153 7.59251L8.48822 6.75886L9.41386 10.0386ZM8.68136 5.99891L12.4527 6.94449L14.5395 4.82236L13.4923 1.10664L8.68136 5.99891ZM15.2795 4.6254L18.9369 5.69426L17.9693 1.85526L14.2324 0.91771L15.2795 4.6254Z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" ${SW}><path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01"/><path d="M20.5 3.5v5.2h-5.2"/></svg>`,
    close: `<svg viewBox="0 0 24 24" ${SW}><path d="M17.5 6.5 6.5 17.5M6.5 6.5l11 11"/></svg>`,
    phone: `<svg viewBox="0 0 24 24" ${SW}><rect x="6.2" y="2.6" width="11.6" height="18.8" rx="2.7"/><path d="M10.6 18.4h2.8"/></svg>`,
    laptop: `<svg viewBox="0 0 24 24" ${SW}><rect x="3.6" y="4.6" width="16.8" height="11.2" rx="2.1"/><path d="M2 19.2h20"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="8.6"/><path d="M3.6 12h16.8"/><path d="M12 3.4c2.2 2.4 3.4 5.3 3.4 8.6S14.2 18.2 12 20.6c-2.2-2.4-3.4-5.3-3.4-8.6S9.8 5.8 12 3.4Z"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.6 4.6 4.6L19 7"/></svg>`,
    alert: `<svg viewBox="0 0 24 24" ${SW}><path d="M10.4 3.3 2.6 17.5a1.85 1.85 0 0 0 1.6 2.8h15.6a1.85 1.85 0 0 0 1.6-2.8L13.6 3.3a1.85 1.85 0 0 0-3.2 0Z"/><path d="M12 9v4.4"/><path d="M12 16.9h.01"/></svg>`,
  };

  // ---- 样式（Shadow DOM 隔离；字体/配色取自 ether.fi 设计令牌）----
  const css = `
  :host { all: initial; }
  :host {
    --efi-card: #19191C;
    --efi-card-hi: #1F1F23;
    --efi-line: rgba(255,255,255,.07);
    --efi-line-2: rgba(255,255,255,.13);
    --efi-text: #FCFCFC;
    --efi-muted: #8B8B92;
    --efi-dim: #5C5C63;
    --efi-gold: #BFAC7F;
    --efi-purple: #8079C9;
    --efi-green: #8DD68A;
    --efi-red: #D56D53;
    --efi-ease: cubic-bezier(.76,0,.24,1);
    --efi-dur: .26s;
    --efi-sans: "Onest","Onest Fallback",-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif;
    --efi-display: "twkGhost","twkGhost Fallback","Iowan Old Style",Baskerville,"Songti SC","Noto Serif CJK SC","Times New Roman",serif;
    --efi-mono: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--efi-sans); }
  button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
  svg { display: block; }

  /* ---------- 悬浮入口 ---------- */
  .launcher {
    position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
    display: inline-flex; align-items: center; gap: 9px;
    height: 40px; padding: 0 16px 0 13px; border-radius: 999px;
    color: var(--efi-text); font-size: 13px; font-weight: 500; letter-spacing: .01em;
    background: rgba(20,20,22,.72); border: 1px solid rgba(255,255,255,.12);
    -webkit-backdrop-filter: blur(20px) saturate(160%); backdrop-filter: blur(20px) saturate(160%);
    box-shadow: 0 10px 30px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.05);
    transition: transform var(--efi-dur) var(--efi-ease), background var(--efi-dur) var(--efi-ease), border-color var(--efi-dur) var(--efi-ease);
  }
  .launcher:hover { transform: translateY(-2px); background: rgba(32,32,35,.84); border-color: rgba(255,255,255,.24); }
  .launcher:active { transform: translateY(0); }
  .launcher .mark { width: 17px; height: 17px; color: var(--efi-purple); }

  /* ---------- 遮罩 / 面板 ---------- */
  .overlay {
    position: fixed; inset: 0; z-index: 2147483647; padding: 24px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(5,5,6,.66);
    -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
    animation: efi-fade .2s var(--efi-ease) both;
  }
  @keyframes efi-fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes efi-rise { from { opacity: 0; transform: translateY(10px) scale(.985) } to { opacity: 1; transform: none } }
  @keyframes efi-up   { from { opacity: 0; transform: translateY(26px) } to { opacity: 1; transform: none } }
  @keyframes efi-spin { to { transform: rotate(360deg) } }
  @keyframes efi-pulse { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
  @keyframes efi-shimmer { from { background-position: 180% 0 } to { background-position: -80% 0 } }

  .panel {
    position: relative; width: min(780px, 100%); max-height: 88vh;
    display: flex; flex-direction: column; overflow: hidden;
    border-radius: 22px; border: 1px solid rgba(255,255,255,.09); color: var(--efi-text);
    background: radial-gradient(130% 92% at 50% -12%, #2A2A30 0%, #17171A 38%, #0E0E10 100%);
    box-shadow: 0 48px 120px rgba(0,0,0,.72), inset 0 1px 0 rgba(255,255,255,.05);
    animation: efi-rise .34s var(--efi-ease) both;
  }

  /* ---------- 标题栏 ---------- */
  .head { display: flex; align-items: center; gap: 11px; padding: 16px 18px 14px; cursor: grab; user-select: none; }
  .head.grabbing { cursor: grabbing; }
  .head .mark { width: 21px; height: 21px; flex: none; color: var(--efi-purple); }
  .brand { flex: 1; min-width: 0; }
  .brand .t { font-size: 13.5px; font-weight: 600; line-height: 1.25; }
  .brand .s { margin-top: 1px; font-family: var(--efi-display); font-weight: 300; font-size: 11.5px; letter-spacing: .08em; color: var(--efi-gold); }
  .iconbtn {
    width: 32px; height: 32px; flex: none; border-radius: 999px;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid rgba(255,255,255,.13); color: #A8A8AE;
    transition: color var(--efi-dur) var(--efi-ease), background var(--efi-dur) var(--efi-ease), border-color var(--efi-dur) var(--efi-ease);
  }
  .iconbtn:hover { color: var(--efi-text); border-color: rgba(255,255,255,.28); background: rgba(255,255,255,.05); }
  .iconbtn svg { width: 15px; height: 15px; }
  .iconbtn.busy svg { animation: efi-spin .9s linear infinite; }

  /* ---------- 统计卡 ---------- */
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 2px 18px 14px; }
  .stat { padding: 12px 14px 13px; border-radius: 14px; border: 1px solid var(--efi-line); background: rgba(255,255,255,.025); }
  .stat .k { font-family: var(--efi-display); font-weight: 300; font-size: 12.5px; letter-spacing: .02em; color: var(--efi-gold); }
  .stat .v { margin-top: 3px; font-size: 26px; font-weight: 500; letter-spacing: -.02em; line-height: 1.1; }
  .stat .v small { margin-left: 5px; font-size: 12px; font-weight: 400; letter-spacing: 0; color: var(--efi-muted); }
  .stat.sel.has .v { color: var(--efi-gold); }

  /* ---------- 工具栏 ---------- */
  .toolbar { display: flex; align-items: center; gap: 10px; padding: 0 18px 12px; }
  .chk { position: relative; display: inline-flex; align-items: center; gap: 9px; cursor: pointer; font-size: 12.5px; color: #C9C9CF; }
  .chk input { position: absolute; opacity: 0; width: 0; height: 0; }
  .box {
    width: 18px; height: 18px; flex: none; border-radius: 6px; color: #0E0E0D;
    border: 1px solid rgba(255,255,255,.22); display: flex; align-items: center; justify-content: center;
    transition: background .18s var(--efi-ease), border-color .18s var(--efi-ease);
  }
  .box svg { width: 11px; height: 11px; opacity: 0; transform: scale(.6); transition: opacity .18s var(--efi-ease), transform .18s var(--efi-ease); }
  .chk:hover .box { border-color: rgba(255,255,255,.4); }
  .chk input:checked + .box { background: var(--efi-gold); border-color: var(--efi-gold); }
  .chk input:checked + .box svg { opacity: 1; transform: none; }
  .chk input:disabled + .box { opacity: .28; }
  .chk input:disabled ~ * { opacity: .5; }

  .prog { height: 2px; background: rgba(255,255,255,.06); overflow: hidden; transition: opacity .4s var(--efi-ease); }
  .prog.hide { opacity: 0; }
  .prog i { display: block; width: 0; height: 100%; background: linear-gradient(90deg, var(--efi-gold), #E7DAB9); transition: width .3s var(--efi-ease); }

  /* ---------- 列表 ---------- */
  .body { overflow: auto; padding: 12px 18px 14px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.16) transparent; }
  .body::-webkit-scrollbar { width: 9px; }
  .body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
  .body::-webkit-scrollbar-track { background: transparent; }

  .card {
    display: flex; gap: 12px; align-items: flex-start; margin-bottom: 9px; padding: 13px 14px;
    border-radius: 14px; border: 1px solid var(--efi-line); background: var(--efi-card);
    transition: background var(--efi-dur) var(--efi-ease), border-color var(--efi-dur) var(--efi-ease);
  }
  .card:last-child { margin-bottom: 0; }
  .card:hover { background: var(--efi-card-hi); border-color: rgba(255,255,255,.11); }
  .card.cur { border-color: rgba(128,121,201,.32); }
  .card.on { border-color: rgba(191,172,127,.42); background: linear-gradient(180deg, rgba(191,172,127,.07), rgba(191,172,127,.02)); }
  .card.gone { opacity: .52; border-color: var(--efi-line); background: var(--efi-card); }
  .card.gone .name { text-decoration: line-through; text-decoration-color: rgba(255,255,255,.3); }
  .card.gone:hover { background: var(--efi-card); }
  .card .chk { padding-top: 9px; }

  .avatar {
    width: 38px; height: 38px; flex: none; border-radius: 12px; color: #B6B6BD;
    border: 1px solid var(--efi-line-2); background: rgba(255,255,255,.03);
    display: flex; align-items: center; justify-content: center;
  }
  .avatar svg { width: 17px; height: 17px; }
  .card.cur .avatar { color: #A79EE8; border-color: rgba(128,121,201,.42); background: rgba(128,121,201,.12); }

  .main { flex: 1; min-width: 0; }
  .titlerow { display: flex; align-items: center; gap: 8px; }
  .name { flex: 0 1 auto; min-width: 0; font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill { flex: none; padding: 2.5px 9px; border-radius: 999px; font-size: 10px; font-weight: 500; letter-spacing: .02em;
          border: 1px solid rgba(128,121,201,.55); color: #A79EE8; }
  .sp { flex: 1 1 auto; }
  .ghost {
    flex: none; height: 27px; padding: 0 12px; border-radius: 999px; font-size: 11.5px; font-weight: 500;
    border: 1px solid rgba(255,255,255,.13); color: #B4B4BB;
    transition: color var(--efi-dur) var(--efi-ease), background var(--efi-dur) var(--efi-ease), border-color var(--efi-dur) var(--efi-ease);
  }
  .ghost:hover { color: #EE9077; border-color: rgba(213,109,83,.55); background: rgba(213,109,83,.10); }
  .ghost:disabled { opacity: .35; pointer-events: none; }

  .sub { margin-top: 2px; font-size: 11.5px; color: var(--efi-muted); }
  .meta { display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; margin-top: 9px; font-size: 11.5px; }
  .meta .k { color: var(--efi-dim); white-space: nowrap; }
  .meta .v { color: #C6C6CC; word-break: break-word; }
  .meta .v.id { font-family: var(--efi-mono); font-size: 10.5px; color: #85858D; cursor: copy; }
  .meta .v.id:hover { color: var(--efi-gold); }
  .geo-load {
    display: inline-block; width: 96px; height: 9px; border-radius: 3px; vertical-align: middle;
    background: linear-gradient(100deg, #232328 30%, #34343B 50%, #232328 70%); background-size: 280% 100%;
    animation: efi-shimmer 1.4s ease-in-out infinite;
  }
  .meta .v.geo.fail { color: var(--efi-dim); cursor: pointer; }
  .meta .v.geo.fail:hover { color: #A8A8AE; }

  .rst { display: none; align-items: center; gap: 7px; margin-top: 9px; font-size: 11px; }
  .rst.show { display: flex; }
  .rst .dot { width: 5px; height: 5px; flex: none; border-radius: 999px; background: currentColor; }
  .rst.busy { color: var(--efi-gold); } .rst.busy .dot { animation: efi-pulse 1s var(--efi-ease) infinite; }
  .rst.ok { color: var(--efi-green); }
  .rst.err { color: #E6A08B; }

  .raw { margin-top: 9px; }
  .raw summary { list-style: none; cursor: pointer; font-size: 10.5px; color: var(--efi-dim); }
  .raw summary::-webkit-details-marker { display: none; }
  .raw summary::before { content: "＋ "; }
  .raw[open] summary::before { content: "－ "; }
  .raw summary:hover { color: #A8A8AE; }
  .raw pre {
    margin-top: 8px; padding: 10px 12px; max-height: 190px; overflow: auto;
    font-family: var(--efi-mono); font-size: 10.5px; line-height: 1.55; color: #8E8E97;
    border-radius: 10px; border: 1px solid var(--efi-line); background: #0B0B0C;
    white-space: pre-wrap; word-break: break-all;
  }

  /* ---------- 空 / 错误 / 骨架 ---------- */
  .state { padding: 46px 22px; text-align: center; }
  .state .mark { width: 34px; height: 34px; margin: 0 auto 15px; color: rgba(255,255,255,.10); }
  .state h2 { font-family: var(--efi-display); font-weight: 300; font-size: 17px; color: var(--efi-gold); }
  .state p { margin-top: 7px; font-size: 12px; line-height: 1.7; color: var(--efi-muted); }
  .state.error h2 { color: #E6A08B; }
  .state pre {
    margin-top: 14px; padding: 12px; max-height: 220px; overflow: auto; text-align: left;
    font-family: var(--efi-mono); font-size: 10.5px; line-height: 1.55; color: #8E8E97;
    border-radius: 12px; border: 1px solid var(--efi-line); background: #0B0B0C; white-space: pre-wrap; word-break: break-all;
  }
  .retry {
    margin-top: 16px; height: 34px; padding: 0 18px; border-radius: 999px; font-size: 12.5px; color: var(--efi-text);
    border: 1px solid rgba(255,255,255,.16); transition: background var(--efi-dur) var(--efi-ease), border-color var(--efi-dur) var(--efi-ease);
  }
  .retry:hover { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.3); }
  .sk {
    height: 88px; margin-bottom: 9px; border-radius: 14px; border: 1px solid var(--efi-line);
    background: linear-gradient(100deg, #17171A 30%, #232328 50%, #17171A 70%); background-size: 280% 100%;
    animation: efi-shimmer 1.4s ease-in-out infinite;
  }

  /* ---------- 底栏 ---------- */
  .foot { display: flex; align-items: center; gap: 12px; padding: 13px 18px; border-top: 1px solid var(--efi-line); background: rgba(10,10,11,.5); }
  .status { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--efi-muted); }
  .status .dot { width: 5px; height: 5px; flex: none; border-radius: 999px; background: var(--efi-dim); }
  .status.empty { visibility: hidden; }
  .status.busy { color: #DCCFAA; } .status.busy .dot { background: var(--efi-gold); animation: efi-pulse 1s var(--efi-ease) infinite; }
  .status.ok { color: #B9D9B7; } .status.ok .dot { background: var(--efi-green); }
  .status.err { color: #E6A08B; } .status.err .dot { background: var(--efi-red); }
  .status a { color: var(--efi-gold); cursor: pointer; border-bottom: 1px solid rgba(191,172,127,.4); }
  .primary {
    flex: none; height: 38px; padding: 0 20px; border-radius: 999px;
    font-size: 13px; font-weight: 600; letter-spacing: .01em; background: #C75B41; color: #FFF1EC;
    transition: background var(--efi-dur) var(--efi-ease), box-shadow var(--efi-dur) var(--efi-ease), color var(--efi-dur) var(--efi-ease);
  }
  .primary:hover:not(:disabled) { background: var(--efi-red); box-shadow: 0 6px 20px rgba(199,91,65,.3); }
  .primary:disabled { background: rgba(255,255,255,.05); color: #55555B; cursor: not-allowed; box-shadow: none; }

  /* ---------- 确认抽屉 ---------- */
  .sheet {
    position: absolute; inset: 0; z-index: 5; display: flex; align-items: flex-end; justify-content: center;
    background: rgba(8,8,9,.62); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
    animation: efi-fade .18s var(--efi-ease) both;
  }
  .sheetbox {
    width: 100%; padding: 20px; border-radius: 20px 20px 0 0;
    border-top: 1px solid var(--efi-line-2); background: #131316;
    animation: efi-up .3s var(--efi-ease) both;
  }
  .sheetbox h3 { font-family: var(--efi-display); font-weight: 300; font-size: 19px; color: var(--efi-gold); }
  .sheetbox p { margin-top: 8px; font-size: 12.5px; line-height: 1.7; color: #C0C0C6; }
  .warn {
    display: flex; gap: 9px; margin-top: 12px; padding: 11px 13px; border-radius: 12px;
    border: 1px solid rgba(213,109,83,.3); background: rgba(213,109,83,.08);
    font-size: 11.5px; line-height: 1.65; color: #EBA891;
  }
  .warn svg { width: 15px; height: 15px; flex: none; margin-top: 1px; }
  .acts { display: flex; justify-content: flex-end; gap: 9px; margin-top: 16px; }
  .cancel { height: 38px; padding: 0 18px; border-radius: 999px; font-size: 13px; color: #D6D6DB; border: 1px solid rgba(255,255,255,.16); transition: background var(--efi-dur) var(--efi-ease); }
  .cancel:hover { background: rgba(255,255,255,.06); }

  @media (max-width: 560px) {
    .stats { grid-template-columns: 1fr; }
    .panel { border-radius: 18px; }
    .overlay { padding: 12px; }
  }
  `;

  // ---- UI ----
  let host, root, panel, listEl, statusEl, selectAllEl, revokeBtn, progEl, refreshBtn;
  let statTotalEl, statSelEl;
  let sessions = [];
  let onKeydown = null;

  function buildUI() {
    host = document.createElement('div');
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);

    const launcher = document.createElement('button');
    launcher.className = 'launcher';
    launcher.innerHTML = ICON.mark + '<span>会话管理</span>';
    launcher.onclick = openPanel;
    root.appendChild(launcher);

    document.documentElement.appendChild(host);
  }

  function openPanel() {
    if (host._overlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.onclick = (e) => { if (e.target === overlay) closePanel(); };

    panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="head" id="drag">
        ${ICON.mark}
        <div class="brand">
          <div class="t">设备会话管理</div>
          <div class="s">SESSION MANAGER</div>
        </div>
        <button class="iconbtn" id="refresh" title="刷新">${ICON.refresh}</button>
        <button class="iconbtn" id="close" title="关闭 (Esc)">${ICON.close}</button>
      </div>
      <div class="stats">
        <div class="stat"><div class="k">活跃会话</div><div class="v" id="st-total">—</div></div>
        <div class="stat sel"><div class="k">已选中</div><div class="v" id="st-sel">—</div></div>
      </div>
      <div class="toolbar">
        <label class="chk">
          <input type="checkbox" id="selall" disabled>
          <span class="box">${ICON.check}</span>
          <span>全选（不含当前设备）</span>
        </label>
      </div>
      <div class="prog hide" id="prog"><i></i></div>
      <div class="body" id="list"></div>
      <div class="foot">
        <div class="status" id="status"><span class="dot"></span><span id="status-text">就绪</span></div>
        <button class="primary" id="revoke" disabled>注销选中</button>
      </div>
    `;
    overlay.appendChild(panel);
    root.appendChild(overlay);

    listEl = panel.querySelector('#list');
    statusEl = panel.querySelector('#status');
    selectAllEl = panel.querySelector('#selall');
    revokeBtn = panel.querySelector('#revoke');
    progEl = panel.querySelector('#prog');
    refreshBtn = panel.querySelector('#refresh');
    statTotalEl = panel.querySelector('#st-total');
    statSelEl = panel.querySelector('#st-sel');

    panel.querySelector('#close').onclick = closePanel;
    refreshBtn.onclick = load;
    revokeBtn.onclick = () => revokeMany(selectedIndexes());
    selectAllEl.onchange = () => {
      listEl.querySelectorAll('input.sel').forEach((cb) => {
        // 保护当前设备：全选时跳过，取消全选时一并清空
        cb.checked = selectAllEl.checked && cb.dataset.current !== '1';
        cb.closest('.card').classList.toggle('on', cb.checked);
      });
      updateCount();
    };
    makeDraggable(panel.querySelector('#drag'), panel, overlay);

    onKeydown = (e) => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('keydown', onKeydown, true);

    host._overlay = overlay;
    load();
  }

  function closePanel() {
    if (onKeydown) { document.removeEventListener('keydown', onKeydown, true); onKeydown = null; }
    if (host._overlay) { host._overlay.remove(); host._overlay = null; }
  }

  function setStatus(text, kind) {
    statusEl.className = 'status' + (kind ? ' ' + kind : '') + (text ? '' : ' empty');
    panel.querySelector('#status-text').innerHTML = text;
  }

  function setProgress(done, total) {
    const bar = progEl.firstElementChild;
    if (!total) {
      progEl.classList.add('hide');
      setTimeout(() => { if (progEl.classList.contains('hide')) bar.style.width = '0'; }, 420);
      return;
    }
    progEl.classList.remove('hide');
    bar.style.width = Math.round((done / total) * 100) + '%';
  }

  async function load() {
    refreshBtn.classList.add('busy');
    listEl.innerHTML = `<div class="sk"></div><div class="sk"></div><div class="sk"></div>`;
    statTotalEl.textContent = '—';
    statSelEl.textContent = '—';
    selectAllEl.checked = false;
    selectAllEl.disabled = true;
    revokeBtn.disabled = true;
    setProgress(0, 0);
    setStatus('正在读取会话…', 'busy');
    try {
      const raw = await listSessions();
      sessions = extractList(raw);
      if (!sessions.length) {
        listEl.innerHTML = `
          <div class="state">
            ${ICON.mark}
            <h2>未解析到会话列表</h2>
            <p>接口返回了数据，但结构不在已知格式内。原始返回如下：</p>
            <pre>${escapeHtml(JSON.stringify(raw, null, 2))}</pre>
          </div>`;
        statTotalEl.textContent = '0';
        statSelEl.textContent = '0';
        setStatus('无可用会话');
        return;
      }
      renderList();
      setStatus('');
    } catch (e) {
      sessions = [];
      listEl.innerHTML = `
        <div class="state error">
          ${ICON.mark}
          <h2>读取失败</h2>
          <p>${escapeHtml(e.message)}</p>
          <button class="retry" id="retry">重试</button>
        </div>`;
      const r = listEl.querySelector('#retry'); if (r) r.onclick = load;
      statTotalEl.textContent = '—';
      statSelEl.textContent = '—';
      setStatus('读取失败', 'err');
    } finally {
      refreshBtn.classList.remove('busy');
    }
  }

  function renderList() {
    geoToken++;
    listEl.innerHTML = '';
    sessions.forEach((s, i) => {
      const id = getId(s);
      const cur = isCurrent(s);
      const card = document.createElement('div');
      card.className = 'card' + (cur ? ' cur' : '');

      const meta = summarizeMeta(s);
      if (id) meta.push(['ID', id]);
      const metaHtml = meta.map(([k, v]) => {
        const key = `<div class="k">${escapeHtml(k)}</div>`;
        if (v && typeof v === 'object' && v.geo) {
          return key + `<div class="v geo" data-geo="${escapeHtml(v.geo)}"><span class="geo-load"></span></div>`;
        }
        const cls = k === 'ID' ? ' id' : '';
        const attr = k === 'ID' ? ` title="${escapeHtml(v)}" data-copy="${escapeHtml(v)}"` : '';
        const txt = k === 'ID' ? shortId(v) : v;
        return key + `<div class="v${cls}"${attr}>${escapeHtml(txt)}</div>`;
      }).join('');

      const sub = deviceSub(s);
      card.innerHTML = `
        <label class="chk">
          <input type="checkbox" class="sel" data-i="${i}" ${cur ? 'data-current="1"' : ''} ${id ? '' : 'disabled'}>
          <span class="box">${ICON.check}</span>
        </label>
        <div class="avatar">${ICON[deviceKind(s)]}</div>
        <div class="main">
          <div class="titlerow">
            <div class="name">${escapeHtml(deviceTitle(s))}</div>
            ${cur ? '<span class="pill">当前设备</span>' : ''}
            <div class="sp"></div>
            ${id ? `<button class="ghost" data-revoke="${i}">注销</button>` : ''}
          </div>
          ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}
          ${id ? '' : '<div class="sub">未找到会话 ID，无法注销</div>'}
          ${metaHtml ? `<div class="meta">${metaHtml}</div>` : ''}
          <div class="rst" data-status="${i}"><span class="dot"></span><span class="txt"></span></div>
          <details class="raw"><summary>原始 JSON</summary><pre>${escapeHtml(JSON.stringify(s, null, 2))}</pre></details>
        </div>
      `;
      listEl.appendChild(card);
    });

    listEl.querySelectorAll('input.sel').forEach((cb) => {
      cb.onchange = () => {
        cb.closest('.card').classList.toggle('on', cb.checked);
        updateCount();
      };
    });
    listEl.querySelectorAll('button[data-revoke]').forEach((b) => {
      b.onclick = () => revokeMany([Number(b.dataset.revoke)]);
    });
    listEl.querySelectorAll('[data-copy]').forEach((el) => {
      el.onclick = () => {
        const full = el.dataset.copy;
        const shown = el.textContent;
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(full).then(() => {
          el.textContent = '已复制';
          setTimeout(() => { el.textContent = shown; }, 900);
        }).catch(() => {});
      };
    });

    updateCount();
    resolveGeoCells();
  }

  // 按 IP 去重后串行查询，结果回填到所有同 IP 的单元格
  async function resolveGeoCells() {
    const byIp = new Map();
    listEl.querySelectorAll('.v.geo[data-geo]').forEach((el) => {
      const ip = el.dataset.geo;
      if (!byIp.has(ip)) byIp.set(ip, []);
      byIp.get(ip).push(el);
    });
    if (!byIp.size) return;

    const token = geoToken;
    for (const [ip, els] of byIp) {
      if (token !== geoToken) return;
      const cached = geoFromCache(ip);
      if (cached) { els.forEach((el) => paintGeo(el, ip, cached)); continue; }
      const e = await lookupGeo(ip);
      if (token !== geoToken) return;
      els.forEach((el) => paintGeo(el, ip, e));
      await new Promise((r) => setTimeout(r, 140)); // 对免费额度友好
    }
  }

  function paintGeo(el, ip, e) {
    if (!e) {
      el.classList.add('fail');
      el.textContent = '查询失败 · 点此重试';
      el.onclick = () => {
        el.classList.remove('fail');
        el.onclick = null;
        el.innerHTML = '<span class="geo-load"></span>';
        lookupGeo(ip).then((r) => paintGeo(el, ip, r));
      };
      return;
    }
    el.classList.remove('fail');
    el.onclick = null;
    const f = flagEmoji(e.cc);
    el.textContent = (f ? f + ' ' : '') + e.text;
    el.title = `${e.src} · IP 归属地为粗略推断，非精确定位`;
  }

  function selectedIndexes() {
    return [...listEl.querySelectorAll('input.sel:checked')].map((cb) => Number(cb.dataset.i));
  }

  function updateCount() {
    const n = selectedIndexes().length;
    const live = listEl.querySelectorAll('.card:not(.gone)').length;
    statTotalEl.innerHTML = live + ' <small>台设备</small>';
    statSelEl.innerHTML = n + (n ? ' <small>待注销</small>' : '');
    statSelEl.parentElement.classList.toggle('has', n > 0);
    revokeBtn.disabled = n === 0;

    const selectable = [...listEl.querySelectorAll('input.sel:not(:disabled)')].filter((cb) => cb.dataset.current !== '1');
    selectAllEl.disabled = selectable.length === 0;
    selectAllEl.checked = selectable.length > 0 && selectable.every((cb) => cb.checked);
  }

  // 面板内确认抽屉（替代原生 confirm，保持视觉一致）
  function askConfirm(count, hasCurrent) {
    return new Promise((resolve) => {
      const sheet = document.createElement('div');
      sheet.className = 'sheet';
      sheet.innerHTML = `
        <div class="sheetbox">
          <h3>确认注销 ${count} 个会话？</h3>
          <p>被注销的设备会立即退出登录，需要重新验证才能再次访问 ether.fi Cash。此操作不可撤销。</p>
          ${hasCurrent ? `<div class="warn">${ICON.alert}<div>所选内容包含<b>当前设备</b>。继续操作后，本浏览器也会退出登录，需要重新登录。</div></div>` : ''}
          <div class="acts">
            <button class="cancel" id="c-no">取消</button>
            <button class="primary" id="c-yes">确认注销</button>
          </div>
        </div>
      `;
      const done = (v) => { sheet.remove(); resolve(v); };
      sheet.querySelector('#c-no').onclick = () => done(false);
      sheet.querySelector('#c-yes').onclick = () => done(true);
      sheet.onclick = (e) => { if (e.target === sheet) done(false); };
      panel.appendChild(sheet);
      sheet.querySelector('#c-yes').focus();
    });
  }

  // 注销成功后：置灰、取消勾选、禁用操作
  function retireRow(i) {
    const cb = listEl.querySelector(`input.sel[data-i="${i}"]`);
    if (!cb) return;
    const card = cb.closest('.card');
    cb.checked = false;
    cb.disabled = true;
    card.classList.remove('on');
    card.classList.add('gone');
    const btn = card.querySelector('.ghost');
    if (btn) btn.remove();
  }

  function setRowStatus(i, kind, text) {
    const el = listEl.querySelector(`[data-status="${i}"]`);
    if (!el) return;
    el.className = 'rst show ' + kind;
    el.querySelector('.txt').textContent = text;
  }

  async function revokeMany(indexes) {
    const targets = indexes
      .map((i) => ({ i, id: getId(sessions[i]), cur: isCurrent(sessions[i]) }))
      .filter((t) => t.id);
    if (!targets.length) return;

    const hasCurrent = targets.some((t) => t.cur);
    if (!(await askConfirm(targets.length, hasCurrent))) return;

    revokeBtn.disabled = true;
    refreshBtn.classList.add('busy');
    listEl.querySelectorAll('.ghost').forEach((b) => (b.disabled = true));

    let ok = 0, fail = 0, done = 0;
    setProgress(0, targets.length);
    for (const t of targets) {
      setRowStatus(t.i, 'busy', '注销中…');
      try {
        const res = await revokeSession(t.id);
        if (res.ok) {
          ok++;
          setRowStatus(t.i, 'ok', `已注销 · HTTP ${res.status}`);
          retireRow(t.i);
        } else {
          fail++;
          setRowStatus(t.i, 'err', `失败 · HTTP ${res.status}` + (res.body ? ' — ' + JSON.stringify(res.body) : ''));
        }
      } catch (e) {
        fail++;
        setRowStatus(t.i, 'err', '错误：' + e.message);
      }
      done++;
      setProgress(done, targets.length);
      setStatus(`处理中 ${done}/${targets.length} · 成功 ${ok} · 失败 ${fail}`, 'busy');
    }

    listEl.querySelectorAll('.ghost').forEach((b) => (b.disabled = false));
    refreshBtn.classList.remove('busy');
    setTimeout(() => setProgress(0, 0), 700);

    let msg = `完成 · 成功 ${ok} · 失败 ${fail} <a id="rl">重新加载</a>`;
    if (hasCurrent && ok > 0) msg += ' — 本设备可能已退出，刷新页面后需重新登录';
    setStatus(msg, fail ? 'err' : 'ok');
    const rl = panel.querySelector('#rl'); if (rl) rl.onclick = load;
    updateCount();
  }

  // ---- 工具 ----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function makeDraggable(handle, el, overlay) {
    let sx, sy, ox, oy, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.iconbtn')) return;
      dragging = true;
      handle.classList.add('grabbing');
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      overlay.style.alignItems = 'flex-start'; overlay.style.justifyContent = 'flex-start';
      el.style.position = 'absolute'; el.style.left = ox + 'px'; el.style.top = oy + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = (ox + e.clientX - sx) + 'px';
      el.style.top = (oy + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
      handle.classList.remove('grabbing');
    });
  }

  buildUI();
})();
