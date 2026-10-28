# OM Record Analyzer

一个用于分析 **Opus Magnum**(Zachtronics 解谜游戏)记录的 Web 工具。它从社区 API 拉取排行榜数据并绘制交互式帕累托前沿图,同时支持通过 WebAssembly 在浏览器本地验证 `.solution` 文件。

[English](./README.md)

## 功能

- **帕累托前沿可视化** — 为选定关卡绘制任意两个指标(成本、周期、面积、指令、高度、宽度、包围六边形、速率及其 `@∞` 变体)的交互式二维散点图。支持对数/线性坐标、拖拽缩放、overlap/trackless/looping 过滤、多 manifold 前沿计算。设置按组收纳在左侧可折叠面板中,图表空间不足时改为覆盖展开。
- **Records 排序** — 布尔标记按 O → T → L 优先于数值指标排序。T 和 L 默认关闭,点击依次切换为 true 优先、false 优先、关闭,并保存设置。
- **本地解答验证** — 上传 `.solution` 文件(Opus Magnum 导出的存档),由编译为 WebAssembly 的引擎在浏览器内完成验证与评分,全程本地计算,无需服务端模拟。
- **前沿检测** — 验证后的解答会叠加在排行榜图上,自动判定「在前沿上」(绿钻)或「不在前沿」(红钻)。上传后,侧边栏会列出具体哪些解答登上了帕累托前沿,以及属于哪些 manifold。
- **批量验证页** — 独立的 `#/validator` 路由,可拖入一整个 `.solution` 文件夹,一次性验证全部,并以表格展示通过/失败/跳过结果。
- **解答播放** — 内嵌 [om-web-simulator](https://omsim-web.pages.dev/player/) 播放器,每页仅初始化一次并在记录间复用,支持播放/暂停、逐周期前后步进、调速及下载解答,同时保留原 omclone 独立 **Preview** 预览按钮。缺少解答文件或 WebGPU 不可用时回退原 GIF/视频。
- **API 代理** — Cloudflare Worker 将请求代理到排行榜 API(`zlbb.faendir.com`),规避 CORS 并使 API 基址可配置。

### 成绩兼容性

新版排行榜的 `areaINF`、`heightINF`、`widthINF`、`boundingHexINF` 均使用 `{ level, value }`,增长率用撇号显示。Pareto 坐标轴对四个 `@∞` 字段统一沿用 `value × 100000^level` 数值转换,支持小数刻度及小于 1 的对数范围。`looping` 独立于 `rate`:进入稳态但不满足 Looping 的解仍可拥有 @∞ 成绩。

旧版已保存成绩会保留有限尺寸,但新版 Looping 状态和此前未测量的增长率显示为未知。重新上传相应 `.solution` 文件即可重算;旧版本的同内容文件不会被重复检测跳过。成绩版本 3 同时修复了进度回调清除验证器错误后,通关后碰撞被误记为 L 未知的问题。确认的通关后碰撞应为 `looping: false`;真正达到周期上限仍可能未知。L 未知的成绩不会被上传去重直接复用。

内置验证器由 [Akias86/omsim fork](https://github.com/Akias86/omsim) 编译,使用包含增量模拟和碰撞控制的工作区(当前为 `extension` 分支)。这些接口已由 fork 提供,本项目无需额外补丁。

更新时,先启用 Emscripten 环境,在本地 fork 目录运行 `make libverify.wasm`。构建直接使用当前工作区,包括未提交修改,无需先提交或推送。编译选项和导出接口由 fork 的 Makefile 管理,默认启用 PGO(`PGO=0` 可关闭)。仅在构建成功后,手动将 `build/libverify.wasm` 复制到本项目的 `src/lib/verify/libverify.wasm`,再运行 `pnpm test`。

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

- **路由** — 轻量哈希路由:`#/puzzle/:id` 打开关卡;`#/validator` 打开批量验证器。从记录表或图表播放时,URL 自动变为 `#/puzzle/:id?record=:recordId`,复制或刷新此链接会自动打开播放器并从头播放,不受当前视图和筛选影响。关闭播放器会清除播放参数,浏览器前进/后退也会同步播放状态。缺少记录 ID 的旧记录使用 `solution` 或 `gif` 参数定位。
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

## 播放器配置

模拟器域名默认使用 `https://omsim-web.pages.dev`,内嵌播放器访问其 `/player/` 路径。与 `LEADERBOARD_API` 相同,通过 `wrangler.jsonc` 中的 **Worker 运行时变量** `PLAYER_ORIGIN` 配置:

```jsonc
"vars": {
  "LEADERBOARD_API": "https://zlbb.faendir.com",
  "PLAYER_ORIGIN": "https://omsim-web.pages.dev"
}
```

播放区域保持原版 GIF 的 826:647 比例（最大 826×647 CSS 像素）,弹窗按可用视口收紧,不在画面周围额外留白。播放器直接绘制固定 826×647 画布,浏览器自然处理缩放,不补偿 DPR。

本地开发时将 `.dev.vars.example` 复制为 `.dev.vars`;本地运行 `om-web-simulator` 时可设置 `PLAYER_ORIGIN=http://127.0.0.1:4173`,然后重启 `pnpm dev`。线上通过 Wrangler 配置或 secret 更新 Worker 变量并刷新页面即可,**无需重新构建前端**。首次播放会读取 `/api/config` 且不缓存响应,常驻播放器在本页面会话内继续使用该域名;该接口仅公开播放器域名,不会暴露其他变量或 secret。WebGPU 需要 HTTPS 或 localhost 及兼容浏览器,远程解答文件下载需支持 CORS。

### 本地解法播放

点击用户解法的表格行、图表点或图表侧边列表中的解法名即可播放。重合点选择列表同时包含排行榜记录与本地解法。共用原播放器控件、Download(保留原文件名)及 Preview 按钮,不查询本地解法的 GitHub 作者。模拟器不可用时,本地解法没有 GIF/视频兜底,弹窗会显示错误,仍可下载或打开 Preview。

验证成功的上传现在会将原始文件保存在**当前浏览器的 IndexedDB** 中,与 localStorage 中的成绩元数据分开存储。旧版仅有成绩的记录需要重新上传一次;未变化的重复文件也会补齐缺失文件,无需重复验证。浏览器存储失败时会提示文件仅在当前会话可播放。Clear 同时清除成绩和保存的解法文件。

本地播放地址为 `#/puzzle/:id?user=:localRecordId`,同一浏览器刷新后可恢复。URL 不包含文件内容或存储键,**不能跨浏览器/设备分享解法**;缺少对应本地数据时提示重新上传。文件不会上传到排行榜或 Worker;播放时传给配置的模拟器 iframe,Preview 时传给打开的预览窗口。

### 记录作者署名

仅在播放器标题下显示小字 `by Author`,作者名链接到署名提交。加载中、查询失败或无法可靠确认作者时整行隐藏;记录表和图表提示不变。

浏览器异步请求 `/api/record-author?solution=…`。Worker 仅接受 zlbb 不可变解答链接,提取提交 SHA,并查询固定的 `zachtronics-leaderboards/om-leaderboard` 仓库。仅采信明确的 `[BOT] … [Solution] by …` 信息及唯一对应的解答文件,不使用 Git 作者字段。历史重建/导入提交无法恢复原作者。

`wrangler.jsonc` 已声明 Workers KV 绑定 `AUTHOR_CACHE`。开发环境使用本地持久化 KV;未填写命名空间 ID 时,当前 Wrangler 会在部署时创建或复用线上命名空间,也可显式填写已有命名空间的 `id`。完整 SHA 的结果与短 SHA 别名均**不设置过期时间**,确认无署名的结果也永久保存;缓存键包含解析版本,方便未来修正规则后重建。KV 是最终一致的,不同地区同时首次查询仍可能发生重复请求。临时失败不会保存为永久未知,Worker 短暂退避后,再次打开播放器可重试。

GitHub 无需认证也可查询,但限额较低。可选运行 `pnpm exec wrangler secret put GITHUB_TOKEN` 配置服务端 Token;本地放在 `.dev.vars` 中。不要使用 `VITE_` 变量或提交 Token。作者查询不会阻塞播放。

## 脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动 Vite 开发服务器(含 HMR + 本地 Worker) |
| `pnpm build` | 类型检查(`tsc -b`)后生产构建 |
| `pnpm preview` | 构建后本地预览生产产物 |
| `pnpm deploy` | 构建后部署到 Cloudflare Workers(`wrangler deploy`) |
| `pnpm lint` | 运行 Oxlint |
| `pnpm test` | 使用 Node.js 内置测试运行器检查播放器、配置、成绩、图表及 WASM 回归测试 |
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
├── public/puzzles/          264 个 .puzzle 文件(静态资源,用于验证)
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
│   │       ├── compare.ts    对比验证分数与排行榜记录
│   │       └── libverify.wasm  预编译 Emscripten 验证器二进制
│   └── test/TestPage.tsx    批量验证页(#/validator)
├── wrangler.jsonc           Cloudflare Worker 配置
└── vite.config.ts
```

## 说明

- 解答验证完全在客户端进行。WASM 二进制(约 180 KB)在主线程编译一次,编译后的 `WebAssembly.Module` 共享给每个 worker,worker 只需执行廉价的实例化/链接步骤。
- 上传后的前沿列表基于**最新**排行榜数据重新计算(绕过缓存),避免排行榜更新后将过时记录误判为前沿。
- `tests/` 使用 Node.js 内置测试运行器检查播放器客户端与协议、Worker 运行时配置、成绩、图表控件与坐标轴及内置 WASM 验证器;`src/test/` 存放的是运行时批量验证页面,而非自动化测试。

## 感谢

- [**omsim**](https://github.com/ianh/omsim) — 原始 C 模拟与评分引擎。
- [**zachtronics-leaderboard-bot**](https://github.com/zachtronics-leaderboards/zachtronics-leaderboard-bot) — 帕累托前沿的计算规则(manifold 定义、指标偏序关系、支配判定)通过分析该项目得出。

