# 开发与验证

使用 Node.js 22 或更新版本。项目使用原生 JavaScript，没有第三方运行时或开发依赖，无需执行 `npm install`。

```sh
npm run check
npm test
npm run package
```

`check` 检查源码、测试和开发脚本的 JavaScript 语法，检查版本一致性与打包文件是否存在。`test` 覆盖域名校验、跨午夜时段、日期范围、每日计时、密码和文字挑战，以及后台的权限验证。`package` 按 `package.json` 的 `files` 清单生成 `dist/website-restrict-v<版本>.zip`，只包含运行插件所需的文件。

## 代码位置

| 文件 | 用途 |
| --- | --- |
| `manifest.json` | Manifest V3 配置与浏览器权限 |
| `background.js` | 后台事件、计时、网络拦截与消息校验 |
| `core.js` | 域名、规则、用量与剩余时间计算 |
| `protection.js` | 密码散列、文字挑战与修改权限判断 |
| `index.html`、`app.js` | 规则管理和保护设置 |
| `content.js` | 网站右下角的剩余时间 |
| `guard-ui.js`、`pin-input.js` | 验证弹窗和数字按钮 |
| `popup.*`、`blocked.*` | 工具栏弹窗与拦截页 |
| `styles.css` | 扩展页面样式 |
| `tests/` | Node.js 自动化测试 |
| `scripts/` | 检查、打包和浏览器验证工具 |

源码保持在项目根目录，避免影响现有本地加载的扩展路径。修改源码后，需要在浏览器扩展管理页重新加载插件，并刷新已打开的受限网站。

## 浏览器验证

Windows 安装 Edge 后可以执行：

```sh
npm run test:browser
```

可通过 `EDGE_PATH` 指定 Edge 可执行文件。脚本使用独立的临时配置与本地测试网页，不读取日常浏览器配置。它验证静态网页计时、页面导航、暂停与拦截、数字按钮输入、连续输错后重试，以及密码或文字挑战的两条验证路径。截图保存在输出的临时目录中。

自动测试不执行真实卸载；该 API 通过模拟验证。发布前还应手动检查锁屏、浏览器重启、跨零点和休眠恢复的行为。

## 打包与提交

修改版本时同时更新 `manifest.json` 和 `package.json`。ZIP、CRX、私钥、浏览器配置和本地环境文件不提交到 Git。历史安装包不保留在源码目录；需要时从对应 Git 提交重新打包。

项目尚未提交扩展商店。上架还需要图标、商店截图、发布者资料，以及可访问的隐私政策链接。
