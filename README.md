<div align="center">
  <img src="https://www.ether.fi/images/favicon/android-chrome-192x192.png" width="72" alt="ether.fi">
  <h1>ether.fi Session Manager</h1>
  <p>A Tampermonkey userscript to <b>list and revoke your ether.fi Cash login sessions</b> — i.e. log out other devices.</p>
</div>

---

## Why

ether.fi Cash keeps you logged in with a server-side cookie session. Changing your
password or adding 2FA does **not** revoke sessions that already exist on other
devices, and the web UI has no "log out of all devices" button. If you signed in
somewhere and forgot to log out, there's no built-in way to kill that session.

This script surfaces ether.fi's own **internal** session-management endpoints
(which the app ships but never exposes in the UI) and gives you a small panel to
select and revoke sessions.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/app/cash/api/v2/sessions` | `GET` | List your active sessions |
| `/app/cash/api/v2/sessions/{id}` | `DELETE` | Revoke a specific session |

It only ever talks to `www.ether.fi` using **your own browser's login cookie** —
no credentials are collected, stored, or sent anywhere else.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or a compatible manager
   such as Violentmonkey).
2. Click to install:
   **[➡ Install `etherfi-session-manager.user.js`](https://raw.githubusercontent.com/__GH_OWNER__/__GH_REPO__/main/etherfi-session-manager.user.js)**
   Tampermonkey will open its install page — confirm.
3. Auto-updates are wired via `@updateURL` / `@downloadURL`, so you'll get new
   versions automatically.

## Usage

1. Open **https://www.ether.fi** and **log in to Cash** (the script uses your
   existing login cookie).
2. Click the **🔒 Sessions** button in the bottom-right corner.
3. The panel lists every active session. Select the ones you want to kill (or use
   **Select all**), then click **Revoke selected**. Each row also has its own
   **Revoke** button.

### Notes

- **Select all** deliberately excludes any session detected as your *current
  device*, so you don't accidentally log yourself out. You can still tick it
  manually to fully reset (you'll be asked to confirm, then need to log in again).
- Response field names weren't publicly documented, so the script parses
  defensively — it auto-detects the session list and the id field, and shows the
  raw JSON of each session. If a row can't find an id, open its **原始 JSON /
  raw JSON** and file an issue with the shape so it can be mapped exactly.

## 中文说明

ether.fi Cash 的登录会话是服务端 cookie 会话，**改密码/加 2FA 都不会让其它设备的会话失效**，界面上也没有“登出所有设备”。本脚本调用 App 自带、但未在界面暴露的内部接口 `GET /v2/sessions` 与 `DELETE /v2/sessions/{id}`，提供一个小面板来查看、选中/全选并注销会话。

- 安装 Tampermonkey → 点上面的安装链接确认。
- 登录 https://www.ether.fi 后，点右下角 **🔒 Sessions**。
- 勾选要踢掉的会话（或“全选”，默认不含当前设备），点“注销选中”。
- 全脚本只与 `www.ether.fi` 通信、只用你自己的登录 cookie，不采集任何凭据。

## How it works

The script mirrors exactly what the ether.fi frontend does for authenticated
requests: same base path (`/app/cash/api`), `credentials: 'include'` (so the
httpOnly session cookie is sent), and the same `X-Active-User` header
(`localStorage.active_user`). See the source — it's a single, dependency-free
`.user.js` file with a Shadow-DOM UI.

## Disclaimer

Not affiliated with, endorsed by, or supported by ether.fi. This is an
independent utility that calls the site's own endpoints on your behalf, for
managing **your own** account's sessions. Use at your own risk. Internal
endpoints can change or be removed at any time without notice.

## License

[MIT](./LICENSE) © __AUTHOR__
