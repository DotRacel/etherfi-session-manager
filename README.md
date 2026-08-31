<div align="center">
  <img src="https://www.ether.fi/images/favicon/android-chrome-192x192.png" width="72" alt="ether.fi">
  <h1>ether.fi 会话管理脚本</h1>
  <p>一个 Tampermonkey 用户脚本，用来<b>查看并注销 ether.fi Cash 的登录会话</b>（登出其它设备）。</p>
  <p>
    <a href="https://raw.githubusercontent.com/DotRacel/etherfi-session-manager/main/etherfi-session-manager.user.js">
      <img src="https://img.shields.io/badge/%E2%AC%87%20%E4%B8%80%E9%94%AE%E5%AE%89%E8%A3%85-Tampermonkey-00857A?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="一键安装">
    </a>
  </p>
  <sub>需先安装 <a href="https://www.tampermonkey.net/">Tampermonkey</a>，点击按钮后确认安装即可。</sub>
</div>

---

## 界面预览

<div align="center">
  <img src="./assets/screenshot.png" width="760" alt="ether.fi 会话管理面板">
</div>

## 为什么需要它

ether.fi 有一个臭名昭著的问题，网站/APP 做的很好，但是就是没有设备管理，**没有地方登出其他设备**，而且无论你如何添加 2FA，还是修改密码，等等，那个设备会话都不会过期，它只会在三个月后自然过期。而且它的安全做的稀烂，转账/查看卡片详情等敏感操作，不会调用你的 2FA，只要你有这个会话，那么你就能看。

本脚本把 ether.fi **自带、却没在界面暴露**的内部会话管理接口调出来，用一个小面板让你选中并注销会话。

> 说明：ether.fi Cash 的会话默认有效期约 **90 天**（见上图“过期于”），在你手动注销或自然过期之前会一直有效。这也是忘记登出的会话能长期存在的原因。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey 等兼容的脚本管理器）。
2. 点击安装：
   **[➡ 安装 `etherfi-session-manager.user.js`](https://raw.githubusercontent.com/DotRacel/etherfi-session-manager/main/etherfi-session-manager.user.js)**
   Tampermonkey 会打开安装页，确认即可。

## 使用

1. 打开 **https://www.ether.fi** 并**登录 Cash**（脚本依赖你已登录的 cookie）。
2. 点击右下角的 **会话管理** 按钮。
3. 面板会列出全部活跃会话。勾选要踢掉的会话（或点 **全选**），再点 **注销选中**；每一行也有单独的 **注销** 按钮。
4. 面板可拖动标题栏移动，按 <kbd>Esc</kbd> 关闭；点击卡片里的会话 ID 可复制完整 ID。

## IP 归属地

接口返回的 `area` 字段基本恒为 `null`，所以只有一个裸 IP：

```json
{ "ipAddress": "74.52.12.174", "deviceName": "Chrome (Mac)", "deviceType": "desktop", "area": null }
```

脚本会在 `area` 缺失时，用公共 IP 库把归属地补上（上图「位置」一行）。实现细节：

- 依次尝试 [ipwho.is](https://ipwho.is/) → [geojs.io](https://get.geojs.io/)，前者失败才走后者；两家都免密钥、支持 HTTPS 与 CORS。
- 请求一律带 `credentials: 'omit'`，**不会**把 ether.fi 的 cookie 带给第三方；发出去的只有那个 IP。
- 结果按 IP 缓存 7 天（`localStorage`），相同 IP 不重复查询。
- 归属地是粗略推断（通常到城市/地区级），不是精确定位；保留网段、内网 IP 会查询失败，可点击该行重试。

## 免责声明

本项目与 ether.fi 无任何隶属、背书或支持关系。这是一个独立的小工具，代表你、针对**你自己的**账户会话，调用该网站自身的接口。请自行承担使用风险。内部接口可能随时更改或下线，恕不另行通知。

## 许可证

[MIT](./LICENSE) © DotRacel
