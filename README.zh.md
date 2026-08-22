# dsh-plugin-token-usage

DeepSeek Harness Token 用量插件：只读扫描本地会话日志，在 Web 界面里给你一块
**GitHub 风格用量热力图 + 跟随粒度联动的模型明细**，侧边栏图标悬停即见
「今日 token」——全程纯本地，不上传任何数据。

![demo](docs/demo.gif)

## 特性

- 🔥 **GitHub 式热力图**：近 30 天逐日一格（零耗日补空格），周日首列、月份标尺、
  今日描边；五档 accent 渐变色阶按视图归一化。
- 🗓 **日 / 周 / 月三档切换**：周以周日为起始与网格列对齐；切换后色阶重新归一化。
- 🫧 **官方 Tooltip 悬停明细**：`08-22 · 4.2亿 token · 请求 341 · 缓存命中 95.9%`，
  气泡左缘与方块左缘对齐、悬停立即出现（delayMs=0），靠窗自动翻转防溢出。
- 🧩 **模型明细跟随粒度**：今日 / 本周 / 本月窗口内精确统计（会话×日、模型×日
  二级聚合，非近似估算），含窗口总计行与空态文案。
- ⚡ **侧边栏图标悬停**：「今日1.25亿token」，30 秒静默轮询，跨零点自动切换。
- 🚿 **零耗模型过滤**：只有请求记录、没有真实消耗的模型不进明细、不计入请求总数。
- 🌗 **主题全适配**：颜色全部映射 DSH 主题变量（`--dsw-alias-*`），深浅色自动跟随。
- 🛠 **模型工具 `usage_report`**：不打开界面也能在对话里直接问"我今天用了多少"。

## 安装

### 方式一（推荐）：一条命令，自挂载

```bash
dsh plugin --profile web add dsh-plugin-token-usage
```

包内自带 `cordis.patch.yml` bundle patch，Host 半区（HTTP 接口 + 模型工具）随安装
自动激活，无需手动改 profile 配置。

### 方式二：手动挂载

1. 把本目录放进（或 `pnpm add file:` 到）`~/.dsh/profiles/web/node_modules/`；
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 追加：

   ```yaml
   - insert:
       - id: token-usage
         name: 'dsh-plugin-token-usage'
         config:
           ttlMs: 15000
   ```

3. 重启 DeepSeek Harness。

> ⚠️ 二选一。若已用方式一自挂载，不要再手动 insert 同名 id，否则双重加载。
>
> **老用户升级必读**：如果你之前按旧教程在 profile 里手动加过上面的 `insert`
> 条目，升级到自挂载版后请**先删除那条 insert 再重启**——包内 patch 与手动
> 条目同时存在会让同一 id 注册两次，启动直接崩溃（报
> `duplicate loader entry id: token-usage`）。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `ttlMs` | `15000` | 扫描结果缓存时长（毫秒），期间重复请求直接命中缓存 |
| `scanTimeoutMs` | `180000` | 单个日志文件解压超时（毫秒） |

## 使用

- **Web GUI**：侧边栏设置行右侧的柱状图标 → 用量总览弹窗；Esc 或点击遮罩关闭。
- **对话工具**：让 agent 调用 `usage_report`（参数 `refresh` 强制重扫、`top` 控制
  模型条数，默认 10、上限 50），返回文本版报告。

## 隐私

只读解析 `~/.dsh/sessions/**` 下的本地会话日志（zstd 流式解压，8 路并发），
无网络请求、无遥测、不写任何文件。

## License

[MIT](./LICENSE)
