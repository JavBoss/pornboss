# JavBoss 助手

## 介绍

JavBoss 助手是一个 Chrome 扩展，支持从 JavBus、JavLibrary、JavDB 和 AVSOX 获取作品信息并回填到 JavBoss，也可以辅助 JavBoss 中的作品、女优、系列和片商链接跳转到 JavDB 的对应详情页。

## 使用说明

1. 打开某个视频的刮削设置，选择**手动刮削**。
2. 在**浏览器扩展辅助刮削**区域点击**打开 JavBus**、**打开 JavLibrary**、**打开 JavDB**或**打开 AVSOX**。
3. 完成目标网站要求的验证，并进入作品详情页。
4. 点击页面右下角由扩展注入的**回填到 JavBoss**按钮。
5. 返回 JavBoss 检查回填内容并保存。

在 JavBoss 的作品、女优、系列或片商页面点击 JavDB 链接时，扩展会立即切换到新标签页。解析 JavDB 中间页面期间标签页保持纯白，并在最终目标页开始加载时显示页面内容。JavDB 自动跳转默认开启，可在浏览器工具栏的 **JavBoss 助手** 设置中关闭；关闭后只打开 JavDB 搜索页。

## 磁力下载与 API 令牌

1. 登录 JavBoss，在 **全局设置 → 安全 → 浏览器扩展 API 令牌** 中点击“新建 API 令牌”，在弹窗填写名称（例如“笔记本 Chrome”）并选择有效期。
2. 复制 Token。设置页直接显示已保存的明文，可随时再次查看和复制。
3. 点击浏览器工具栏中的 **JavBoss 助手**，在独立的 **连接设置** 中填写 Server 地址和 API 令牌，可先点击 **测试连接** 验证当前输入的地址和令牌，再到 **磁力下载** 中打开 **启用磁力下载**。地址、令牌和开关修改后自动保存并生效。
4. 在 HTTP/HTTPS 网站点击磁力链接，确认后提交到 JavBoss 下载队列。

远程 Server 必须使用 HTTPS（例如 `https://javboss.example.com`），本机 `localhost`、`127.0.0.1`、`[::1]` 可使用 HTTP。支持地址包含反向代理子路径。连接设置只保存当前的 JavBoss 地址和 API 令牌；修改地址不会切换或清空令牌，不再保存历史服务器配置。旧配置首次打开设置时仅保留当前连接，并清理历史令牌。

Token 是浏览器扩展的接口凭据，不区分 scope；后台按请求方法和路由配置哪些接口接受 Token，目前开放 `POST /extension/downloads` 和 `GET /extension/status`（连接及鉴权检查）。后台支持查看有效期、最近使用时间、重新生成及删除。重新生成后旧 Token 立即失效；删除某个 API 令牌不会影响其他浏览器。到期或删除后，扩展会提示重新配置 Token。

扩展将 Token 保存在仅可信扩展上下文可访问的本地存储，不进行 Chrome Sync 同步。service worker 提交下载、扩展设置页测试连接时会向指定 Server 发送 Token；页面内容脚本只能读取磁力下载启用状态。扩展不会跟随下载接口的 HTTP 重定向，Server 地址应填写最终地址。

**升级说明：**后端已取消扩展下载接口的匿名访问。需要同时更新后端和扩展（0.11.0 起），然后在扩展中配置 Token；旧版扩展的无 Token 请求会返回 401。

## 后台接口

Token 管理接口使用网页登录 Cookie 鉴权，不接受扩展 API 令牌：

| 方法与路径 | 功能 |
| --- | --- |
| `GET /auth/extension-tokens` | 列出 API 令牌，包括明文 `token` |
| `POST /auth/extension-tokens` | 创建 API 令牌，JSON：`{"name":"笔记本 Chrome","expires_in_days":365}` |
| `POST /auth/extension-tokens/:id/rotate` | 重新生成 API 令牌，JSON：`{"expires_in_days":90}` |
| `DELETE /auth/extension-tokens/:id` | 删除 API 令牌及其记录 |

`name` 为 1–80 个字符；`expires_in_days` 为 1–365，省略时默认 365 天，显式传入 `0` 表示永不过期。创建和重新生成弹窗均可选择有效期；永不过期的 `expires_at` 为 `0001-01-01T00:00:00Z`（Go 时间零值），仍支持删除和重新生成。创建和重新生成返回 `{item, token}`；列表中的每个 `item` 也包含明文 `token`。Token 存入数据库的 `token` 列，不保存 scope 或哈希。

扩展只对已启用的接口使用 `Authorization: Bearer <token>`。`POST /extension/downloads` 保留为下载入口，请求体仍为 `{"magnet_url":"magnet:?xt=urn:btih:..."}`。缺少、错误、过期、删除的凭据返回 401；浏览器来源不符返回 403。扩展 Token 不通过 Cookie 或 URL 参数传入。指定 Bearer 时优先校验 Token，不会在失败后退回 Cookie。

JavBoss 助手的固定扩展 Origin 只可对已配置的接口发起跨域请求；`OPTIONS` 无需 Token，目前允许 `POST /extension/downloads` 与 `GET /extension/status`，请求头允许 `Content-Type`、`Authorization`。无 Origin 的客户端使用 Bearer Token 时也受相同接口配置限制。网页 Cookie 登录保留原有来源校验。

`GET /auth/status`、`POST /auth/logout`、`PUT /auth/password` 及令牌管理等接口均不接受扩展 Token，携带 Bearer 请求返回 403，不会退回 Cookie 鉴权。要停止某个扩展访问，请在设置页删除对应令牌。

接口配置位于 `internal/server/extension_api_access.go` 的 `extensionTokenAPIs`，按路径和 HTTP 方法显式启用；未配置接口默认拒绝。预检使用相同配置，只允许已启用的方法。

## 验证

```sh
node --test browser-extension/tests/*.test.js
GOCACHE=$(pwd)/.gocache go test ./internal/server ./internal/db
```
