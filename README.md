# OmniAgent · 多模型协作智能体开发工具

类 opencode / codex / claude code 的智能体开发工具。你**自带模型**（填 API 地址+密钥，可指向任意
端口如本地 `localhost:11434`），**下载插件**扩展能力，并配置多个**岗位(role)**，让多模型像团队一样协作：

```
指挥 Director → 规划 Planner → 多岗位 Workers（并行）→ 检验 Verifier（不通过则补做）
```

- **终端优先**：OpenCode 风格 TUI —— 居中大标志欢迎屏，输入指令后切换为「左栏对话 / 右栏回复」双栏布局，标志作背景水印。
- **本地 Web 应用**：`serve` 后在浏览器打开 `http://localhost:3000`，可视化看每个岗位的思考与工具调用。
- **官方官网**：`site` 启动 `http://localhost:8080`，含插件中心与反馈。
- 纯 Node.js（**零第三方依赖**），不会卡在 `npm install`。

## 📦 下载安装（一分钟上手）

### 1. 下载

```bash
git clone https://github.com/05ca2/OmniAgent.git
cd OmniAgent
```

> 不用 git 的话，在 GitHub 页面点 **Code → Download ZIP** 解压即可。

### 2. 安装 `omniagent` 全局命令

```bash
npm install -g .
```

零依赖、无编译、秒装。完成后你的终端里就有了 `omniagent` 命令（Windows 的 PowerShell / CMD 同样适用）。

> 不想装全局命令？也可以始终用 `node bin/omni.js` 代替 `omniagent`，效果完全一样。

### 3. 初始化配置（交互式）

```bash
omniagent init
```

会**在终端里直接问你**三件事，填完即就绪（所有岗位统一使用，之后可手工改成多模型协作）：

```
初始化 OmniAgent（预设 full）
填写 API 信息（所有岗位模型将统一使用，之后可手工改为多模型协作）：
API base_url (https://api.openai.com/v1):
API key: ********
模型名 (gpt-4o-mini):
✓ 配置已写入：D:\...\OmniAgent\.omni\config.json
✓ 初始化完成 ✓  直接运行  omniagent  即可进入界面（无需任何参数）。
```

> 非交互环境（如管道 / CI）下 `init` 会先生成带空密钥的配置文件，并提示你之后手工补 `api_key`，
> 或在真实终端重跑 `omniagent init` 交互式填写。
>
> 想接入本地模型（Ollama 等）？`API base_url` 填 `http://localhost:11434/v1` 即可。

### 4. 开始使用

初始化结束（或已填好密钥）后，**直接敲命令即可进入界面**，无需任何参数：

```bash
omniagent
```

> 在不带参数的情况下运行 `omniagent`（且处于终端）会自动进入交互界面；若尚未 `init` 会提示你先初始化。
> 想跑单次任务而非交互，可用 `omniagent run "你的任务"`。

**还没有 API 密钥？** 先体验全流程：进入界面后输入 `/mock` 切换演示模式（无需任何密钥），
或者单次执行 `omniagent run "调研 RAG 主流方案" --mock`。

### 升级

```bash
cd OmniAgent
git pull
npm install -g .
```

## 🖥️ 界面导览

**启动画面**（输入指令前）：居中大标志 + 带边框输入框 + 当前岗位/模型状态行 + 快捷键提示：

```
                    ██ OmniAgent 标志 ██

            ┌──────────────────────────────────────┐
            │ Ask anything…  "输入任务，回车开始"      │
            │ 岗位名称  ·  模型 ID                    │
            └──────────────────────────────────────┘
                        tab agents   ctrl+p commands

                  ● Tip 运行 /help 查看全部命令

```

**输入指令后**：自动切换为双栏布局 —— **左栏**是对话（你的指令 / 流水线阶段 / 工具调用），
**右栏**实时显示模型回复，OmniAgent 标志以暗色水印作背景。

## ⌨️ 快捷键与命令

| 操作 | 作用 |
| --- | --- |
| （直接输入文字 + Enter） | 作为任务跑一次编排 |
| `tab` | 切换岗位（输入框下方状态行实时更新） |
| `ctrl+p` | 展开 / 收起命令面板 |
| `esc` | 中断当前运行 / 清空输入 |
| `ctrl+c` | 退出 |
| `/mock` | 切换演示模式（无需密钥） |
| `/model <id>` | 切换本次会话统一使用的模型，如 `/model main` |
| `/status` | 查看模型 / 岗位 / 插件状态 |
| `/reload` | 重新加载 `.omni/config.json`（改了配置不用重启） |
| `/clear` | 清空对话 |

单次执行（不进交互）：`omniagent run "你的任务"`（可加 `--mock` / `--preset`）。
管道或非 TTY 下输出自动去色，方便重定向到文件。

## 本地 Web 应用

```bash
omniagent init
omniagent serve        # 浏览器打开 http://localhost:3000
```

在「配置」页可视化填模型密钥 → 在「运行」页跑任务，实时看每个岗位的思考与工具调用。

## 官方官网（插件中心 + 反馈）

```bash
omniagent site         # 启动官网 http://localhost:8080
```

- **插件中心**：列出可下载插件，点「下载 .js」或复制 `plugin add` 命令安装。
- **反馈**：底部表单提交后落地到 `site/feedback.json`。

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
下载第三方插件：在网页「插件中心」一键安装，或 `omniagent plugin add <url>`
（存到 `.omni/plugins`，下次自动加载）。
示例插件见 `site/plugins/`：`translator`、`calculator`、`clock`。
⚠️ 第三方插件会获得 shell/文件执行权限，只装可信来源。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `init [--preset name]` | 初始化配置 |
| `chat [--mock] [--preset name]` | 终端交互模式（反复对话） |
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
