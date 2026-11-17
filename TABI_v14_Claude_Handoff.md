# TABI — Japan Solo Trip AI｜第 14 版 Claude 交接说明

## 项目与版本

TABI 是邵天卓（Shao）发起的个人项目，面向计划在日本独自旅行的用户。以东京或大阪为固定住宿基地，用户先按月份、天数、节奏和兴趣生成参考路线，再搜索、收藏并调整目的地。项目源于我自己在日本独旅时筛选地点和规划路线的需求。

- 导出来源：Codex Sites 第 14 版的发布提交 `bdc82baff2cced284c02fd7a844c43f0f88a7b69`。
- [线上演示](https://tabi-solo-japan.shiruisun01.chatgpt.site/) 由 ChatGPT Sites 管理访问权限。
- GitHub `jingyuxu183/tabi-solo-japan` 此前导出的 `main` 提交 `17d35de` 是早期静态原型。分析第 14 版时，请打开本包的 `TABI_v14/`。

## 已实现的产品流程

1. **先生成路线。** 用户选择基地、月份、旅行天数、节奏和兴趣，可以补充必去地点、日期与时段。前端调用 `POST /api/plan` 生成每日安排。AI 服务不可用时，前端使用本地规则生成参考路线。
2. **再联网找地点。** 用户可输入「推荐三个仙台的牛舌店」或「九州能看海的小城市」。`POST /api/discover` 先使用 DeepSeek 理解地区、数量、对象类型等条件，按需要进行澄清，再由 Tavily 检索。目的地研究和具体场所研究走不同分支，由 DeepSeek 整理结果。结果按地区、类型、数量和证据等条件校验，具体场所数量不足时会尝试一次纠错。
3. **细化并保存。** 可以收藏、追加到指定日期或替换已有地点。与当前基地不兼容的全国候选可单独收藏。行程与收藏可保存在浏览器，行程也可导出为文字。

## 代码入口

| 路径 | 主要用途 |
| --- | --- |
| `README.md` | 仓库原始文档、架构图和回归场景 |
| `web/index.html`、`web/style.css` | 用户界面与响应式布局 |
| `web/app.js` | 界面状态、路线编辑、AI 接口调用、规则兜底与本地存储 |
| `worker/runtime.js` | Cloudflare Worker 兼容的服务端。重点读 `generateTrip`、`planDiscovery`、`researchDestinations`、`researchSpecificPlaces` 和 `discoverPlaces` |
| `data/catalog.json` | 基础地点库，东京和大阪各 26 个 |
| `scripts/` | 构建、界面结构测试、部署产物校验 |
| `dist/server/index.js` | 构建生成的 Worker，内含网页资源。代码改动应从 `web/`、`worker/` 或 `data/` 入手 |
| `.openai/hosting.json`、`.env.example` | 原站点托管配置和空值环境变量示例 |

## 构建、验证与运行

在 `TABI_v14/` 使用 Node.js 18 或以上版本，仓库没有 npm 依赖。

```bash
npm run build
npm test
npm run validate
```

第 14 版需要能运行 Worker 的环境，由 `dist/server/index.js` 的 `fetch` 同时提供页面和 API。简单的静态文件服务器无法执行两个 API。行程生成需要服务端环境变量 `DEEPSEEK_API_KEY`，联网发现另需 `TAVILY_API_KEY`。包里只有空值模板，密钥应在运行环境配置。

导出时已通过构建、仓库测试和部署产物校验，重建的 Worker 与提交中的文件一致。另核对了页面资源和无密钥时两个 API 的响应。这次没有使用真实密钥重跑第三方请求。

## 给 Claude 的开场提示

> 这是 TABI 在 Codex Sites 发布的第 14 版。请先读这份说明、README.md、web/app.js 和 worker/runtime.js。帮我按代码梳理「生成行程 → 联网找地点 → 追加或替换」的产品流程，并标明 DeepSeek、Tavily、结果校验和规则兜底各负责什么。先给我梳理结果，等我提出具体需求后再改代码。
