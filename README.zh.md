# OM Record Analyzer

一个用于分析 **Opus Magnum**(Zachtronics 解谜游戏)记录的 Web 工具。它从社区 API 拉取排行榜数据并绘制交互式帕累托前沿图,同时支持通过 WebAssembly 在浏览器本地验证 `.solution` 文件。

[English](./README.md)

## 功能

- **帕累托前沿可视化** — 为选定关卡绘制任意两个指标(成本、周期、面积、指令、高度、宽度、包围六边形、速率及其 `@∞` 变体)的交互式二维散点图。支持对数/线性坐标、拖拽缩放、overlap/trackless 过滤、多 manifold 前沿计算。
- **本地解答验证** — 上传 `.solution` 文件(Opus Magnum 导出的存档),由编译为 WebAssembly 的引擎在浏览器内完成验证与评分,全程本地计算,无需服务端模拟。
- **前沿检测** — 验证后的解答会叠加在排行榜图上,自动判定「在前沿上」(绿钻)或「不在前沿」(红钻)。上传后,侧边栏会列出具体哪些解答登上了帕累托前沿,以及属于哪些 manifold。
- **批量验证页** — 独立的 `#/solver` 路由,可拖入一整个 `.solution` 文件夹,一次性验证全部,并以表格展示通过/失败/跳过结果。
- **API 代理** — Cloudflare Worker 将请求代理到排行榜 API(`zlbb.faendir.com`),规避 CORS 并使 API 基址可配置。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19 + TypeScript 6,Vite 8,Recharts 3 |
| 后端 / 托管 | Cloudflare Workers(Wrangler 4),SPA 静态资源 |
| 验证引擎 | WebAssembly(Emscripten 编译的 `libverify.wasm`) |
| 并行 | Web Worker 池(共享编译后的 WASM 模块,transferable 缓冲区) |
| 代码检查 | Oxlint(Oxc) |
| 包管理 | pnpm |

## 架构

```
浏览器 SPA ── /api/om/* ──▶ Cloudflare Worker ──▶ zlbb.faendir.com(排行榜 API)
   │
   ├─ /puzzles/*.puzzle  (静态资源,用于验证)
   └─ libverify.wasm     (加载到 Web Worker 中,模拟并评分解答)
```

- **路由** — 轻量哈希路由:`#/puzzle/:id` 打开关卡的帕累托图;`#/solver` 打开批量验证器。
- **验证流水线** — `verifyBatch` 编排:并行预取全部唯一关卡字节(内存缓存)→ 将解答字节派发到 Web Worker 池(2–4 个 worker,共享同一份编译后的 WASM 模块)→ 通过进度回调收集结果。解答缓冲区以 transferable 形式发送(零拷贝)。worker 不可用时自动回退主线程。
- **前沿计算** — `computeUserFrontierByManifold` 将排行榜分数与用户分数合并,按 manifold 计算非支配集,并标记「登上前沿 **且不等于任何排行榜记录**」的用户解答(即真正推进前沿的新点,而非平局)。
- **缓存** — API 响应缓存于 localStorage(1 天 TTL)。用户解答与前沿摘要同样持久化,刷新页面后前沿列表仍然保留。

## 前置要求

- Node.js(ES2023+ 运行时)
- pnpm

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 Vite 打印的本地开发地址。开发服务器通过 `@cloudflare/vite-plugin` 同时本地运行 Cloudflare Worker,因此 `/api/om/*` 代理开箱即用。

## 脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动 Vite 开发服务器(含 HMR + 本地 Worker) |
| `pnpm build` | 类型检查(`tsc -b`)后生产构建 |
| `pnpm preview` | 构建后本地预览生产产物 |
| `pnpm deploy` | 构建后部署到 Cloudflare Workers(`wrangler deploy`) |
| `pnpm lint` | 运行 Oxlint |
| `pnpm cf-typegen` | 重新生成 Cloudflare Worker 类型定义 |

## 部署

部署目标是 Cloudflare Workers。`LEADERBOARD_API` 环境变量(默认 `https://zlbb.faendir.com`)配置上游排行榜 API,可在 `wrangler.jsonc` 中设置或通过 Wrangler secret 配置。

```bash
pnpm deploy
```

## 项目结构

```
om-record-analyzer/
├── worker/index.ts          Cloudflare Worker:/api/om/* → 排行榜 API 代理
├── public/puzzles/          252 个 .puzzle 文件(静态资源,用于验证)
├── src/
│   ├── App.tsx              哈希路由
│   ├── api/om.ts            API 客户端 + localStorage 缓存层
│   ├── components/
│   │   ├── Sidebar.tsx      关卡树、上传 UI、前沿结果列表
│   │   └── ParetoChart.tsx  主图:散点、帕累托覆盖、缩放、用户点
│   ├── state/userSolutions.tsx   Context:用户上传 + 前沿摘要
│   ├── lib/
│   │   ├── manifold.ts      Manifold 定义 + 帕累托前沿算法
│   │   ├── userFrontier.ts  共享前沿计算 + 批量摘要
│   │   └── verify/
│   │       ├── verifier.ts    WASM 加载器(编译一次,每个 worker 实例化)
│   │       ├── verifyWorker.ts  Worker 入口:在 worker 中执行验证
│   │       ├── workerPool.ts  Worker 池(含主线程回退)
│   │       ├── batch.ts      批量编排(预取 + 并行派发)
│   │       ├── run.ts        纯验证核心(worker 与主线程共用)
│   │       ├── puzzle.ts     缓存关卡字节 + 并行预取
│   │       ├── metrics.ts    从 WASM 计算评分指标
│   │       ├── solution-parse.ts  解析 .solution 头(关卡 ID、名称)
│   │       ├── format.ts     VerifiedScore → 可读字符串
│   │       ├── convert.ts    VerifiedScore → OmScoreDTO
│   │       ├── compare.ts    对比验证分数与排行榜记录
│   │       └── libverify.wasm  预编译 Emscripten 验证器二进制
│   └── test/TestPage.tsx    批量验证页(#/solver)
├── wrangler.jsonc           Cloudflare Worker 配置
└── vite.config.ts
```

## 说明

- 解答验证完全在客户端进行。WASM 二进制(约 150 KB)在主线程编译一次,编译后的 `WebAssembly.Module` 共享给每个 worker,worker 只需执行廉价的实例化/链接步骤。
- 上传后的前沿列表基于**最新**排行榜数据重新计算(绕过缓存),避免排行榜更新后将过时记录误判为前沿。
- 未配置测试框架;`src/test/` 存放的是运行时批量验证页面,而非自动化测试。

## 感谢

- [**omsim**](https://github.com/ianh/omsim) — WebAssembly 验证器(`libverify.wasm`)由该项目的 C/C++ 源码编译而来。所有解答模拟与评分均运行于其引擎之上。
- [**zachtronics-leaderboard-bot**](https://github.com/F43nd1r/zachtronics-leaderboard-bot) — 帕累托前沿的计算规则(manifold 定义、指标偏序关系、支配判定)通过分析该项目得出。

