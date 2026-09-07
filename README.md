# Wall Go 双人远程对弈

一个可以两个人在不同地方用手机浏览器一起玩的 Wall Go 棋类游戏。
无需安装 App，打开网址、输房间号、直接开始玩。

## 功能
- 🎮 完整的 Wall Go 游戏（7×7 棋盘，放置阶段 + 行动阶段）
- 🌐 远程双人对战（创建房间 / 加入房间，4 位房间号）
- 📱 手机浏览器直接玩，无需下载安装
- 🔄 实时同步，回合制，轮到你时才能操作
- 🌙 支持深色模式

## 永久部署（推荐：Render.com 免费版）

两个人都在美国的话，Render.com 免费版完全够用，延迟很低。

### 部署步骤（约 5 分钟）

#### 第一步：创建 GitHub 账号（免费）
1. 去 https://github.com 注册一个账号
2. 创建一个新仓库（New Repository），名字随便，比如 `wall-go`
3. 把这个项目的文件上传到你的 GitHub 仓库

#### 第二步：用 Render 一键部署
1. 去 https://render.com 用 GitHub 账号登录（免费）
2. 点击右上角 "New +" → "Web Service"
3. 选择你刚才创建的 GitHub 仓库
4. 填写以下设置：
   - **Name**: 随便起（这会成为网址的一部分，比如 `wall-go-game`）
   - **Region**: 选 `Oregon (US West)` 或 `Ohio (US East)`，选离你近的
   - **Runtime**: `Node`
   - **Build Command**: 
     ```
     npm install --legacy-peer-deps && npm run build && cd server && npm install
     ```
   - **Start Command**: 
     ```
     node server/server.js
     ```
   - **Plan**: `Free`
5. 点击 "Create Web Service"
6. 等 2-3 分钟部署完成，你会得到一个网址，比如：
   `https://wall-go-game.onrender.com`

#### 第三步：分享给朋友
把这个网址发给你朋友，两个人都在手机浏览器打开：
- 你：点 "🌐 Remote Play" → "Create Room" → 得到 4 位房间号
- 朋友：点 "🌐 Remote Play" → 输入房间号 → "Join Room"
- 开始玩！

> **注意**：Render 免费版如果 15 分钟没人用会休眠，第一次打开可能需要等 10-20 秒唤醒。之后就正常了。

## 本地开发

```bash
# 安装依赖
npm install --legacy-peer-deps
cd server && npm install && cd ..

# 构建前端
npm run build

# 启动服务器（同时托管前端页面 + WebSocket）
cd server && node server.js
```

然后打开 http://localhost:8080

## 技术栈
- 前端：React + TypeScript + Vite + TailwindCSS
- 状态管理：Zustand
- 后端：Node.js + ws (WebSocket)
- 游戏逻辑：基于开源 wall-go 项目修改

## 许可证
MIT
