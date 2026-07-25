// ==UserScript==
// @name         ether.fi Session Manager (Logout Devices)
// @namespace    https://www.ether.fi/
// @version      1.0.1
// @description  列出 ether.fi Cash 的所有登录会话，支持选中/全选并注销（登出其它设备）。使用站点自身的内部接口 GET /v2/sessions 与 DELETE /v2/sessions/{id}。
// @author       you
// @icon         https://www.ether.fi/images/favicon/android-chrome-192x192.png
// @icon64       https://www.ether.fi/images/favicon/android-chrome-512x512.png
// @homepageURL  https://github.com/__GH_OWNER__/__GH_REPO__
// @supportURL   https://github.com/__GH_OWNER__/__GH_REPO__/issues
// @updateURL    https://raw.githubusercontent.com/__GH_OWNER__/__GH_REPO__/main/etherfi-session-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/__GH_OWNER__/__GH_REPO__/main/etherfi-session-manager.user.js
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

  function summarize(s) {
    const rows = [];
    const add = (label, hit) => { if (hit) rows.push([label, fmtVal(hit.val)]); };
    add('设备', pick(s, ['deviceName', 'device', 'deviceType', 'deviceModel']));
    add('系统', pick(s, ['os', 'operatingSystem', 'platform']));
    add('浏览器', pick(s, ['browser', 'client', 'userAgent', 'ua']));
    add('IP', pick(s, ['ipAddress', 'ip', 'ipAddr', 'remoteIp']));
    add('位置', pick(s, ['location', 'city', 'region', 'country', 'geo']));
    add('创建于', pick(s, ['createdAt', 'created', 'creationTime', 'loginAt', 'createdTime', 'issuedAt']));
    add('最近活动', pick(s, ['lastActiveAt', 'lastActive', 'lastUsedAt', 'lastSeenAt', 'updatedAt', 'lastUsed']));
    add('过期于', pick(s, ['expiresAt', 'expiry', 'expireAt', 'expiresAtDate', 'exp']));
    return rows;
  }

  // ---- UI（Shadow DOM 隔离样式）----
  let host, root, panel, listEl, statusEl, countEl, selectAllEl;
  let sessions = [];

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
    .launcher {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
      background: #111827; color: #fff; border: 1px solid #374151; border-radius: 999px;
      padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
      box-shadow: 0 6px 20px rgba(0,0,0,.35);
    }
    .launcher:hover { background: #1f2937; }
    .overlay {
      position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.5);
      display: flex; align-items: center; justify-content: center;
    }
    .panel {
      width: min(720px, 94vw); max-height: 86vh; display: flex; flex-direction: column;
      background: #0b0f17; color: #e5e7eb; border: 1px solid #1f2937; border-radius: 14px;
      box-shadow: 0 20px 60px rgba(0,0,0,.6); overflow: hidden;
    }
    .head {
      display: flex; align-items: center; gap: 10px; padding: 14px 16px;
      border-bottom: 1px solid #1f2937; cursor: move; user-select: none;
    }
    .head h1 { font-size: 15px; margin: 0; flex: 1; font-weight: 700; }
    .head button { background: #1f2937; color: #e5e7eb; border: 1px solid #374151;
      border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
    .head button:hover { background: #374151; }
    .toolbar {
      display: flex; align-items: center; gap: 12px; padding: 10px 16px;
      border-bottom: 1px solid #1f2937; font-size: 13px;
    }
    .toolbar label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .count { color: #9ca3af; }
    .body { overflow: auto; padding: 8px 12px; }
    .card {
      border: 1px solid #1f2937; border-radius: 10px; padding: 10px 12px; margin: 8px 0;
      display: flex; gap: 12px; align-items: flex-start; background: #0f1420;
    }
    .card.cur { border-color: #b45309; background: #1a1305; }
    .card input[type=checkbox] { width: 18px; height: 18px; margin-top: 2px; cursor: pointer; }
    .info { flex: 1; min-width: 0; }
    .idline { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #93c5fd; word-break: break-all; }
    .badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px;
      background: #b45309; color: #fff; margin-left: 8px; vertical-align: middle; }
    .kv { display: grid; grid-template-columns: 72px 1fr; gap: 2px 10px; margin-top: 6px; font-size: 12px; color: #cbd5e1; }
    .kv .k { color: #6b7280; }
    .rowbtns { display: flex; flex-direction: column; gap: 6px; }
    .rowbtns button { background: #7f1d1d; color: #fecaca; border: 1px solid #991b1b;
      border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; }
    .rowbtns button:hover { background: #991b1b; color: #fff; }
    .rowstatus { font-size: 11px; margin-top: 4px; }
    .ok { color: #34d399; } .err { color: #f87171; } .muted { color: #9ca3af; }
    .raw { margin-top: 6px; }
    .raw summary { cursor: pointer; color: #6b7280; font-size: 11px; }
    .raw pre { margin: 6px 0 0; padding: 8px; background: #060911; border: 1px solid #1f2937;
      border-radius: 8px; font-size: 11px; max-height: 180px; overflow: auto; color: #94a3b8; }
    .foot {
      display: flex; align-items: center; gap: 12px; padding: 12px 16px;
      border-top: 1px solid #1f2937;
    }
    .status { flex: 1; font-size: 12px; color: #9ca3af; min-height: 16px; }
    .danger { background: #dc2626; color: #fff; border: none; border-radius: 10px;
      padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
    .danger:disabled { opacity: .5; cursor: not-allowed; }
    .danger:hover:not(:disabled) { background: #ef4444; }
    .empty { padding: 30px; text-align: center; color: #9ca3af; font-size: 13px; }
    a.reload { color: #93c5fd; cursor: pointer; text-decoration: underline; }
  `;

  function buildUI() {
    host = document.createElement('div');
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);

    const launcher = document.createElement('button');
    launcher.className = 'launcher';
    launcher.textContent = '🔒 Sessions';
    launcher.onclick = openPanel;
    root.appendChild(launcher);

    document.documentElement.appendChild(host);
  }

  function openPanel() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.onclick = (e) => { if (e.target === overlay) closePanel(); };

    panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="head" id="drag">
        <h1>ether.fi 登录会话管理</h1>
        <button id="refresh">刷新</button>
        <button id="close">关闭</button>
      </div>
      <div class="toolbar">
        <label><input type="checkbox" id="selall"> 全选（不含“当前设备”）</label>
        <span class="count" id="count"></span>
      </div>
      <div class="body" id="list"><div class="empty">加载中…</div></div>
      <div class="foot">
        <div class="status" id="status"></div>
        <button class="danger" id="revoke" disabled>注销选中</button>
      </div>
    `;
    overlay.appendChild(panel);
    root.appendChild(overlay);

    listEl = panel.querySelector('#list');
    statusEl = panel.querySelector('#status');
    countEl = panel.querySelector('#count');
    selectAllEl = panel.querySelector('#selall');

    panel.querySelector('#close').onclick = closePanel;
    panel.querySelector('#refresh').onclick = load;
    panel.querySelector('#revoke').onclick = revokeSelected;
    selectAllEl.onchange = () => {
      listEl.querySelectorAll('input.sel').forEach((cb) => {
        if (!cb.dataset.current || selectAllEl.checked === false) cb.checked = selectAllEl.checked;
        if (cb.dataset.current === '1' && selectAllEl.checked) cb.checked = false; // 保护当前设备
      });
      updateCount();
    };
    makeDraggable(panel.querySelector('#drag'), panel, overlay);

    host._overlay = overlay;
    load();
  }

  function closePanel() {
    if (host._overlay) { host._overlay.remove(); host._overlay = null; }
  }

  async function load() {
    listEl.innerHTML = `<div class="empty">加载中…</div>`;
    statusEl.textContent = '';
    try {
      const raw = await listSessions();
      sessions = extractList(raw);
      if (!sessions.length) {
        listEl.innerHTML = `<div class="empty">未解析到会话列表。<br>原始返回：<br><pre style="text-align:left;white-space:pre-wrap">${escapeHtml(JSON.stringify(raw, null, 2))}</pre></div>`;
        countEl.textContent = '';
        panel.querySelector('#revoke').disabled = true;
        return;
      }
      renderList();
    } catch (e) {
      listEl.innerHTML = `<div class="empty err">${escapeHtml(e.message)}</div>`;
      countEl.textContent = '';
      panel.querySelector('#revoke').disabled = true;
    }
  }

  function renderList() {
    listEl.innerHTML = '';
    sessions.forEach((s, i) => {
      const id = getId(s);
      const cur = isCurrent(s);
      const card = document.createElement('div');
      card.className = 'card' + (cur ? ' cur' : '');
      const kv = summarize(s).map(([k, v]) => `<div class="k">${escapeHtml(k)}</div><div>${escapeHtml(v)}</div>`).join('');
      card.innerHTML = `
        <input type="checkbox" class="sel" data-i="${i}" ${cur ? 'data-current="1"' : ''} ${id ? '' : 'disabled'}>
        <div class="info">
          <div class="idline">${id ? 'ID: ' + escapeHtml(id) : '（未找到会话 ID，无法注销）'}${cur ? '<span class="badge">当前设备</span>' : ''}</div>
          ${kv ? `<div class="kv">${kv}</div>` : ''}
          <div class="rowstatus muted" data-status="${i}"></div>
          <details class="raw"><summary>原始 JSON</summary><pre>${escapeHtml(JSON.stringify(s, null, 2))}</pre></details>
        </div>
        <div class="rowbtns">${id ? `<button data-revoke="${i}">注销</button>` : ''}</div>
      `;
      listEl.appendChild(card);
    });
    listEl.querySelectorAll('input.sel').forEach((cb) => cb.onchange = updateCount);
    listEl.querySelectorAll('button[data-revoke]').forEach((b) => {
      b.onclick = () => revokeMany([Number(b.dataset.revoke)]);
    });
    updateCount();
  }

  function selectedIndexes() {
    return [...listEl.querySelectorAll('input.sel:checked')].map((cb) => Number(cb.dataset.i));
  }

  function updateCount() {
    const n = selectedIndexes().length;
    countEl.textContent = `共 ${sessions.length} 个会话，已选 ${n} 个`;
    panel.querySelector('#revoke').disabled = n === 0;
  }

  async function revokeSelected() {
    revokeMany(selectedIndexes());
  }

  async function revokeMany(indexes) {
    const targets = indexes
      .map((i) => ({ i, id: getId(sessions[i]), cur: isCurrent(sessions[i]) }))
      .filter((t) => t.id);
    if (!targets.length) return;

    const hasCurrent = targets.some((t) => t.cur);
    const msg = `确认注销 ${targets.length} 个会话？` +
      (hasCurrent ? '\n\n⚠ 其中包含“当前设备”，注销后本浏览器也会退出登录，需要重新登录。' : '');
    if (!confirm(msg)) return;

    panel.querySelector('#revoke').disabled = true;
    let ok = 0, fail = 0;
    for (const t of targets) {
      const stEl = listEl.querySelector(`[data-status="${t.i}"]`);
      if (stEl) { stEl.className = 'rowstatus muted'; stEl.textContent = '注销中…'; }
      try {
        const res = await revokeSession(t.id);
        if (res.ok) {
          ok++;
          if (stEl) { stEl.className = 'rowstatus ok'; stEl.textContent = `已注销 (HTTP ${res.status})`; }
        } else {
          fail++;
          if (stEl) { stEl.className = 'rowstatus err'; stEl.textContent = `失败 HTTP ${res.status}${res.body ? ' — ' + JSON.stringify(res.body) : ''}`; }
        }
      } catch (e) {
        fail++;
        if (stEl) { stEl.className = 'rowstatus err'; stEl.textContent = '错误：' + e.message; }
      }
      statusEl.textContent = `进度：成功 ${ok} / 失败 ${fail} / 共 ${targets.length}`;
    }
    statusEl.innerHTML = `完成：成功 ${ok}，失败 ${fail}。<a class="reload" id="rl">重新加载列表</a>`;
    const rl = panel.querySelector('#rl'); if (rl) rl.onclick = load;
    // 若可能把自己也注销了，提示
    if (targets.some((t) => t.cur) && ok > 0) {
      statusEl.innerHTML += ' — 本设备可能已退出，刷新页面后需重新登录。';
    }
  }

  // ---- 工具 ----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function makeDraggable(handle, el, overlay) {
    let sx, sy, ox, oy, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
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
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  buildUI();
})();
