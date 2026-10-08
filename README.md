# OmniAgent · 多模型协作智能体开发工具

类 opencode / codex / claude code 的智能体开发工具。你**自带模型**（填 API 地址+密钥，可指向任意
端口如本地 `localhost:11434`），**下载插件**扩展能力，并配置多个**岗位(role)**，让多模型像团队一样协作：

```
指挥 Director → 规划 Planner → 多岗位 Workers（并行）→ 检验 Verifier（不通过则补做）
```

- **本地 Web 应用**：`serve` 后在浏览器打开 `http://localhost:3000`，可视化看每个岗位的思考与工具调用。
- **官方官网**：`site` 启动 `http://localhost:8080`，含插件中心与反馈。
- 纯 Node.js（零第三方依赖），不会卡在 `npm install`。

## 快速开始（本地 Web 应用）

```bash
node bin/omni.js init                 # 生成 .omni/config.json（预设 full）
node bin/omni.js serve                # 启动本地服务
# 浏览器打开 http://localhost:3000 → 在「配置」页填模型密钥 → 在「运行」页跑任务
```

无密钥先体验全流程（内置 mock 模型）：打开网页勾选「演示模式」再运行，或直接：

```bash
node bin/omni.js run "调研 RAG 主流方案" --mock
```

## 在终端 / PowerShell 中直接使用（推荐）

不依赖浏览器，直接在终端里跑。**opencode 风格 TUI**：像素 logo、边框输入框、岗位状态行：

```bash
node bin/omni.js init
node bin/omni.js                      # 终端里直接敲这行 → 进入交互界面（需先 init）
# 或显式：
node bin/omni.js chat                 # 同上
```

界面下方常驻「岗位 · 模型」状态行与 Tip 提示。快捷键与命令：

| 操作 | 作用 |
| --- | --- |
| （直接输入文字 + Enter） | 作为任务跑一次编排 |
| `tab` | 切换岗位（输入框下方状态行实时更新） |
| `ctrl+p` | 展开 / 收起命令面板 |
| `ctrl+c` | 退出 |
| `/mock` | 切换演示模式（无需密钥） |
| `/model <id>` | 切换本次会话统一使用的模型，如 `/model main` |
| `/status` | 查看模型 / 岗位 / 插件状态 |
| `/reload` | 重新加载 `.omni/config.json`（改了配置不用重启） |

单次执行（不进交互）：`node bin/omni.js run "你的任务"`（可加 `--mock` / `--preset`）。
管道或非 TTY 下输出自动去色，方便重定向到文件。

## 官方官网（插件中心 + 反馈）

```bash
node bin/omni.js site                 # 启动官网 http://localhost:8080
```

- **插件中心**：列出可下载插件，点「下载 .js」或复制 `plugin add` 命令安装。
- **反馈**：底部表单提交后落地到 `site/feedback.json`。
- 本地应用的「插件中心」默认从 `http://localhost:8080/plugins.json` 拉取市场列表，可一键安装。

## 模型接入（OpenAI 兼容）

在 `models` 里加任意多个，每个填 `base_url` / `api_key` / `model`。`base_url` 可指向任意端点，
包括本地：`http://localhost:11434/v1`（Ollama）。兼容：OpenAI、DeepSeek、OpenRouter、Ollama、
vLLM、通义千问、智谱、月之暗面 等。

```json
"models": {
  "smart": { "base_url": "https://api.openai.com/v1",  "api_key": "sk-...", "model": "gpt-4o" },
  "coder": { "base_url": "http://localhost:11434/v1",  "api_key": "ollama", "model": "qwen2.5-coder" }
}
```

## 岗位（多模型协作的核心）

`roles` 里每个岗位引用一个 `model`，并声明可用 `tools`（插件）。把不同岗位指向不同模型，
就实现了"一个下指令、一个写 plan、不同领域模型干活、一个检验"的协作。在「配置」页可视化增删改，
或直接改 `.omni/config.json`，也可 `preset apply` 套用预设。

## 插件（可下载的能力）

内置：`file`（读写搜索）、`shell`（执行命令）、`web`（联网抓取/搜索）。
下载第三方插件：在网页「插件中心」一键安装，或 `node bin/omni.js plugin add <url>`
（存到 `.omni/plugins`，下次自动加载）。
示例插件见 `site/plugins/`：`translator`、`calculator`、`clock`。
⚠️ 第三方插件会获得 shell/文件执行权限，只装可信来源。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `init [--preset name]` | 初始化配置 |
| `chat [--mock] [--preset name]` | 终端交互模式（类 claude code，反复对话） |
| （无参数，且为终端） | 同 `chat`，直接进入交互模式 |
| `run "<任务>" [--mock] [--preset name]` | 单次跑编排流水线（终端） |
| `serve [--port 3000]` | 启动本地 Web 应用 |
| `site [--port 8080]` | 启动官方官网（插件中心/反馈） |
| `config` / `roles` / `models` | 查看配置 |
| `plugin add <url>` | 下载插件 |
| `preset list` / `preset apply <name>` | 预设管理 |
| `help` | 帮助 |

运行报告自动保存到 `.omni/runs/`。

## 目录结构

```
bin/omni.js             CLI 入口（init/run/serve/site/config/...）
src/
  config.js            配置读写（.omni/config.json）
  presets.js           预设岗位与流水线
  llm.js               OpenAI 兼容客户端（流式 + tool calling + mock）
  plugins/             内置插件 file/shell/web + 注册表
  agents.js            岗位 agent 循环（思考→工具→回填）
  orchestrator.js      Director→Planner→Workers→Verifier 编排
  server.js            本地 Web 服务（静态 + API + SSE）
  trace.js             CLI/Web 共用的事件槽
  report.js            运行报告渲染
public/                本地 Web 应用前端（index.html/styles.css/app.js）
site/                  官方网站（index.html/styles.css/site.js/server.js/plugins.json/plugins/*）
```
