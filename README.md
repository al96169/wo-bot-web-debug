# wo-bot-web-debug

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Vue 3](https://img.shields.io/badge/Vue-3.5-4FC08D.svg)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6.svg)](https://www.typescriptlang.org/)

wo-bot 网页调试控制台，基于 Vue 3 + TypeScript + Vite 构建。用于在局域网内通过浏览器对机器人进行开发调试，通过 WebSocket/WebRTC 与 [wo-bot-control](https://github.com/al96169/wo-bot-control) 通信。

**作者**: Antonio Leung
**GitHub**: https://github.com/al96169/wo-bot-web-debug
**包名**: com.antonioleung.wobot.webdebug

## 功能特性

- **设备发现**: mDNS (Bonjour) 局域网自动发现机器人
- **实时遥控**: 摇杆控制麦轮底盘运动（平移 + 偏航）
- **键盘控制**: W/A/S/D/Q/E 键盘操控
- **摄像头视频**: WebRTC MJPEG 视频流回传
- **系统状态**: 实时显示 CPU/内存/网络/电池状态
- **SSH 终端**: 浏览器内 SSH 命令执行
- **软件管理**: 安装/卸载/升级机器人端软件
- **紧急停止**: 一键急停 + 自动急停保护
- **跳舞模块**: 预设舞蹈动作序列

## 快速开始

### 依赖

- Node.js >= 18
- npm >= 9

### 安装

```bash
git clone https://github.com/al96169/wo-bot-web-debug.git
cd wo-bot-web-debug
npm install
```

### 开发

```bash
npm run dev
# → http://localhost:9093
```

### 构建

```bash
npm run build
# 输出到 dist/
```

### 代码质量

```bash
npm run lint        # ESLint 检查 + 自动修复
npm run format      # Prettier 格式化
npm run type-check  # TypeScript 类型检查
```

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Vue 3 (Composition API + `<script setup>`) |
| 语言 | TypeScript 6.0 |
| 构建 | Vite 8 |
| 状态管理 | Pinia |
| 路由 | Vue Router 5 |
| WebRTC | 浏览器原生 RTCPeerConnection |
| 设备发现 | mDNS (bonjour-service) |
| UI 组件 | 自研（控制台风格） |
| 代码质量 | ESLint + Prettier + vue-tsc |

## 项目结构

```
wo-bot-web-debug/
├── src/
│   ├── components/       # Vue 组件
│   │   ├── views/        # 各功能页面视图
│   │   └── dialogs/      # 弹窗组件
│   ├── composables/      # 组合式函数
│   │   ├── useWebSocket.ts   # WebSocket 信令层
│   │   ├── useWebRTC.ts      # WebRTC 连接层
│   │   ├── useDiscovery.ts   # mDNS 设备发现
│   │   └── useMock.ts        # Mock 模式
│   ├── stores/           # Pinia 状态
│   ├── router/           # 路由配置
│   ├── types/            # TypeScript 类型定义
│   └── plugins/          # Vite 插件
├── public/               # 静态资源
├── eslint.config.js      # ESLint 配置
├── .prettierrc           # Prettier 配置
└── vite.config.ts        # Vite 配置
```

## 通信协议

遵循 [wo-bot-control 通信协议](https://github.com/al96169/wo-bot-control/blob/main/docs/protocol.md)，支持 19 种消息类型。

## 相关项目

| 项目 | 说明 |
|------|------|
| [wo-bot-control](https://github.com/al96169/wo-bot-control) | 机器人控制端（Python，Jetson） |
| [wo-bot-app](https://github.com/al96169/wo-bot-app) | 移动端 App（Flutter，规划中） |

## License

[MIT](LICENSE) © 2024 Antonio Leung
