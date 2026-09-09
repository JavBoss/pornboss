# JavBoss 开发者说明

## 开发环境依赖

- Go `1.25.1` 或更高版本
- Node.js 和 npm

## 技术栈

- Backend: Go + Gin + GORM + SQLite
- Frontend: React + Vite + Tailwind + Zustand
- 媒体探测: `ffprobe`
- 缩略图截图生成: macOS 使用 `ffmpeg`，其他平台使用 `mpv`
- 播放与手动截图: `mpv`

## 常用命令

下载依赖（`ffprobe` + `mpv`，macOS 额外下载 `ffmpeg`）：

```bash
./scripts/cli.sh download linux-x86_64
```

安装前端依赖：

```bash
cd web
npm install
```

启动后端：

```bash
./scripts/cli.sh dev backend
```

按 Docker 运行时配置启动本地后端（用于调试容器模式行为）：

```bash
DOCKER_MODE=1 ./scripts/cli.sh dev backend
```

该模式会启用 `JAVBOSS_CONTAINER=1`，禁用 API token、桌面集成和 mpv 播放，并使用 ffmpeg 生成截图。需要本机可通过 `FFMPEG_PATH`、`internal/bin/ffmpeg` 或系统 `PATH` 找到 `ffmpeg`。本地调试默认不会把前端输入的目录自动加上 `/host` 前缀，也不会把 `127.0.0.1` 代理改写为 `host.docker.internal`；如需测试 Docker 宿主机路径映射，可使用 `DOCKER_MODE=1 JAVBOSS_HOST_PATH_PREFIX=1 ./scripts/cli.sh dev backend`，如需测试 Docker 代理网关映射，可额外设置 `JAVBOSS_PROXY_HOST_GATEWAY=1`。

启动前端：

```bash
./scripts/cli.sh dev frontend
```

前端检查：

```bash
cd web
npm run lint
npm run build
```

打包发布：

```bash
scripts/cli.sh release linux-x86_64 v0.1.0
```

## 项目结构

```text
cmd/server             Go 服务入口
cmd/javprovider        JAV 元数据 provider 调试入口
internal/common        全局状态与共享配置
internal/db            GORM 模型查询与 SQLite 存储
internal/jav           JAV 元数据与女优资料抓取
internal/manager       封面下载与截图任务
internal/models        数据模型定义
internal/mpv           mpv 播放、快捷键与手动截图配置
internal/server        HTTP API 与静态资源路由
internal/service       目录扫描、JAV 识别、资料补全
internal/util          文件、系统、代理、视频探测等工具
web/                   React + Tailwind 前端
scripts/cli            开发、依赖下载与发布辅助 CLI
data/                  运行期数据库、封面、缩略图与缓存
```

## 目录浏览接口

`GET /directories/browse` 使用现有登录认证，返回服务端文件系统中的当前路径 `path`、上级路径 `parent`（根目录为空）、用户目录 `home`、根目录/Windows 盘符 `roots`，以及直属子目录 `directories`（每项包含 `name` 和 `path`）。

- `path`：可选的绝对目录路径，默认服务端用户主目录。Docker 宿主机路径需使用容器内映射路径，例如 `/host/mnt/disk1/videos`。
- `show_hidden`：可选，`true` 时包含名称以 `.` 开头的目录，默认隐藏。

新增/编辑扫描目录和本地下载目录共用站内选择弹窗。Client 模式浏览远端 Server 的目录。设置 `JAVBOSS_DISABLE_DIRECTORY_PICKER=1` 可显式禁用目录浏览。旧的 `POST /directories/pick` 原生选择接口已移除。
