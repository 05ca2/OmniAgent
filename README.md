<p align="center">
  <img src="assets/wordmark.svg" alt="ORCODE" width="420" height="75" />
</p>

# ORcode · 多模型协作智能体开发工具

类 opencode / codex / claude code 的智能体开发工具。你**自带模型**（填 API 地址+密钥，可指向任意
端口如本地 `localhost:11434`），**下载插件**扩展能力，并配置多个**岗位(role)**，让多模型像团队一样协作：

```
指挥 Director → 规划 Planner → 多岗位 Workers（并行）→ 检验 Verifier（不通过则补做）
```

- **终端优先**：Codex 风格极简 TUI —— 独立窗口、左上常驻 ORCODE 名称标识；全程「左栏对话 / 右栏工作树」双栏布局，支持滚轮/↑↓ 翻看历史。
- **两种协作模式**：默认**单模型直接对话**；输入 `/hoa-loop <任务>`（需已装 skill）才启动"指挥→规划→执行→检验"多模型流水线，各阶段进独立子会话。
- **本地 Web 应用**：`serve` 后在浏览器打开 `http://localhost:3000`，可视化看每个岗位的思考与工具调用。
- **官方官网**：`site` 启动 `http://localhost:8080`，含插件中心与反馈。
- 纯 Node.js（**零第三方依赖**），不会卡在 `npm install`。

## 📦 下载安装（一分钟上手）

### 1. 下载

```bash
git clone https://github.com/05ca2/ORcode.git
cd ORcode
```

> 不用 git 的话，在 GitHub 页面点 **Code → Download ZIP** 解压即可。

### 2. 安装 `orcode` 全局命令

```bash
npm install -g .
```

零依赖、无编译、秒装。完成后你的终端里就有了 `orcode` 命令（Windows 的 PowerShell / CMD 同样适用）。

> 不想装全局命令？也可以始终用 `node bin/orcode.js` 代替 `orcode`，效果完全一样。

### 3. 初始化配置（交互式）

```bash
orcode init
```

会**以问卷形式一题一题问你**（直接回车 = 使用括号中的默认值；输入内容明文可见，仅保存在本机）：

```
[1/4] API base_url (https://api.openai.com/v1): http://token.sensenova.cn/v1
[2/4] API key（明文显示，仅保存在本机）: sk-xxxx
[3/4] 模型名 (gpt-4o-mini): deepseek-chat

—— 请确认 ——
base_url: http://token.sensenova.cn/v1
模型名:   deepseek-chat
API key:  sk-y****eHs
[4/4] 确认写入以上配置？ (Y): y

✓ 配置已写入：D:\...\ORcode\.omni\config.json
✓ 初始化完成 ✓  直接运行  orcode  即可进入界面（无需任何参数）。
```

> 非交互环境（如管道 / CI）下 `init` 会先生成带空密钥的配置文件，并提示你之后手工补 `api_key`，
> 或在真实终端重跑 `orcode init` 交互式填写。
>
> 想接入本地模型（Ollama 等）？`API base_url` 填 `http://localhost:11434/v1` 即可。

### 4. 开始使用

初始化结束（或已填好密钥）后，**直接敲命令即可进入界面**，无需任何参数：

```bash
orcode
```

> 在不带参数的情况下运行 `orcode`（且处于终端）会自动进入交互界面；若尚未 `init` 会提示你先初始化。
> 想跑单次任务而非交互，可用 `orcode run "你的任务"`。

**还没有 API 密钥？** 先体验全流程：进入界面后输入 `/mock` 切换演示模式（无需任何密钥），
或者单次执行 `orcode run "调研 RAG 主流方案" --mock`。

### 升级

```bash
cd ORcode
git pull
npm install -g .
```

## 🖥️ 界面导览

**启动画面**（输入指令前）：左上角 **ORCODE 名称标识** + 右栏工作树常驻：

```
.███. ████. .███. .███. ████. █████                                       ┃ ▾ 工作树 · 多模型协作
█...█ █...█ █...█ █...█ █...█ █....                                       ┃
█...█ ████. █.... █...█ █...█ ████.                                       ┃       ○ 指挥 Director  mock-mode
█...█ █.█.. █...█ █...█ █...█ █....                                       ┃   │     拆解任务、分派岗位
.███. █..█. .███. .███. ████. █████                                       ┃   ├─▶ ○ 规划 Planner  mock-model
                                                                          ┃   │     制定顺序执行计划
  D:\新建文件夹\openrelay                          ┃   ├─▶ ○ 执行 Workers  —
  permissions: YOLO mode                                                  ┃   │     多岗位并发协作执行
                                                                          ┃   └─▶ ○ 检验 Verifier  mock-mode
欢迎使用 ORcode 终端模式 —— 直接输入任务，或输入 / 查看命令。tab 切换     ┃         核查结果并驱动修复
岗位，ctrl+p 命令面板。                                                   ┃
                                                                          ┃   待命 · 输入任务后按此流程协作
                                                                          ┃   5 个岗位 · 1 个模型 · 0 token
                                                                          ┃
                                                                          ┃
                                                                          ┃
                                                                          ┃
                                                                          ┃
                                                                          ┃
                                                                          ┃
                                                                          ┃
                                                                          ┃
                                                                          ┃
                                                                          ┃
                                                                          ┃
                                                                          ┃
 ❯ Ask ORcode to do anything                                              ┃
mock-model · D:\新建文件夹\openrelay · mock        ┃
                                       tab for agents · ? for shortcuts   ┃                          ⚙ 设置
```

标识资源：
- [`assets/wordmark.svg`](assets/wordmark.svg) —— **ORCODE 像素字标**（700×125），官网与本README 顶部使用，由 `tools/gen-wordmark.mjs` 从命令行同一套 5×5 字形表生成（圆角像素块 + ORC 深灰 / ODE 浅灰 + 底部立体暗带 + 基线圆点）；
- [`assets/logo-badge-512.png`](assets/logo-badge-512.png) / [`assets/logo-white-512.png`](assets/logo-white-512.png) —— 螺旋星芒图像标志（保留圆形底 / 透明底），网页版使用。

**输入指令后**：切换到双栏布局——**左栏**是对话流（左上角常驻品牌标志，不随滚动移动），
**右栏**是工作树 / 子会话列表 / 设置入口。

> ⚠️ **两种模式**
> - **默认 = 单个模型直接对话**：直接输入文字并回车，由当前选中的模型（或第一个模型）直接回答，**不进入多模型流水线**。
> - **多模型协作 = `/hoa-loop <任务>`**：只有输入以 `/hoa-loop` 开头、且本机已安装 skill/插件（演示模式 `--mock` 下无需）时，才会启动
>   "指挥→规划→执行→检验"多模型流水线，并把规划/执行/检验各自放进独立子会话。

## ⌨️ 快捷键与命令

| 操作 | 作用 |
| --- | --- |
| （直接输入文字 + Enter） | 单个模型直接对话（默认，不进流水线） |
| `/hoa-loop <任务>` | 启动多模型协作流水线（需已装 skill；演示模式 `--mock` 无需） |
| `tab` | 切换岗位（输入框下方状态行实时更新） |
| `ctrl+p` | 展开 / 收起命令面板 |
| `↑` `↓` / 滚轮 | 在主会话里翻看历史记录（左上角标识固定不动） |
| `esc` ×2（900ms 内连按） | 中断当前正在运行的任务（按一次只提示，防误触） |
| `esc` | 清空输入 / 关闭面板 / 返回详情页 / 取消向导 |
| `ctrl+c` | 退出 |
| `/mock` | 切换演示模式（无需密钥） |
| `/model` | 打开**选择模型界面**（按供应商分组、可搜索、点选） |
| `/model <id>` | 直接用键名切换当前模型 |
| `/models` | 列出全部模型：显示名 / 供应商 / 键名 / model id / 接口地址 |
| `/models add` | 批量添加 OpenAI 兼容模型（向导式，见下） |
| `/settings` | 打开**设置页**（为每个岗位分配模型 · 调整并发/核查轮数 · 添加模型） |
| `/open` / `/open <n>` | 列出 / 打开子会话详情页（规划/执行/检验，见下） |
| `/status` | 查看模型 / 岗位 / 插件状态 |
| `/reload` | 重新加载 `.omni/config.json`（改了配置不用重启） |
| `/clear` | 清空对话 |

单次执行（不进交互）：`orcode run "你的任务"`（可加 `--mock` / `--preset`）。
管道或非 TTY 下输出自动去色，方便重定向到文件。

### 子会话：规划/执行/检验各自独立窗口

主会话**只显示指挥（Director）的思考和下达的命令**；规划 Planner、每个执行岗位 Worker、
检验 Verifier 的全部思考与工作过程都进各自的**子会话**。打开方式（任选）：

- **点击右栏**子会话列表里的任意条目；
- 输入 `/open` 查看列表，`/open 2` 打开 2 号子会话。

详情页是独立全屏窗口：`esc` / 回车 / `q` 返回主会话，`↑` `↓` 滚动历史，
运行中的子会话实时刷新（推理原文也会滚动显示）。

### 不确定就先问（澄清问卷）

任务有关键不确定点（目标/平台/技术栈/标准）时，指挥会先暂停流水线，把问题做成
**逐题问卷**（`[澄清 1/2] …`）让你逐个回答，答完自动带着补充说明重新拆解继续跑。
按 `esc` 可跳过剩余问题（按"未回答"处理）。

### 鼠标与设置

- 终端开启鼠标上报：**命令弹层（按 `/`）可直接点击执行**；
- 右栏**子会话列表可点击**打开详情页；
- **右下角 `⚙ 设置·添加模型`** 点击即打开设置页；设置页内点 **＋ 添加模型** 进入添加向导；
- 输入 `/model`（或点状态栏模型名）打开**选择模型界面**：按供应商分组、输入即搜索、`↑` `↓` 移动、回车选用、点击也行；
- 左上角常驻大字 **OMNIAGENT** 像素标识（OMNI 灰 / AGENT 亮白），滚动历史时始终固定在顶部不动；
- 主会话支持**滚轮 / `↑` `↓`** 翻看之前的对话记录。

### 设置页（`/settings` 或右下角 ⚙）

独立的设置窗口，写后即存到 `.omni/config.json`：

- **为每个岗位分配模型**：逐行 `◀ 模型 ▶`，`↑` `↓` 选中、`◀` `▶` 或点击切换（在已配置的模型间循环）；
- **hoa-loop 个性化**：并发数（workers 同时执行）、核查轮数（verifier 修复回路）；
- **＋ 添加模型**：进入 OpenAI 兼容向导，可一次性添加多个模型。

### 最终输出

任务结束时，核查结论 + 最终交付会以**品红色块**单独呈现在主会话里（区别于过程信息，
自动压缩到 14 行以内；完整内容见 `.omni/runs/` 下的运行报告）。

### 边跑边输入（排队执行）

模型在工作中时你**依然可以打字**，回车即加入队列（提示行显示 `✉ 已排队 N 条`），
当前任务结束后自动按序继续执行。想停下来就**连按两次 esc**。

### 实时推理进度

输入框上方会实时显示 `⠋ 推理中 3.4s · 调用 deepseek-chat · 工具:...`，
若模型支持推理流（`reasoning_content`，如 DeepSeek R1 / OpenRouter 上的推理模型），
还会滚动显示模型当前的思考原文；每段思考结束会在对话流留下 `✽ Thought: 3.4s`。

### 批量添加模型（`/models add`）

只接受 **OpenAI 兼容接口**。向导逐项询问，一个模型 5 问：

1. 供应商显示名称（如 `OpenRouter` / `DeepSeek` / `LM Studio`）
2. 接口地址 URL（必须以 `http(s)://` 开头，如 `https://openrouter.ai/api/v1`）
3. API Key（本地服务可填 `local`）
4. 模型 ID（如 `deepseek/deepseek-r1`、`gpt-4o-mini`）
5. 模型显示名称（直接回车 = 同模型 ID）

填完一个后会问「继续添加下一个？」，输 `y` 接着加，直接回车则**一次性保存全部**并写入
`.omni/config.json`（键名由模型 ID 自动生成，重名自动加后缀）。随时按 `esc` 取消。
命令行下 `orcode models` 也能列出同样的信息。

## 本地 Web 应用

```bash
orcode init
orcode serve        # 浏览器打开 http://localhost:3000
```

在「配置」页可视化填模型密钥 → 在「运行」页跑任务，实时看每个岗位的思考与工具调用。

## 官方官网（插件中心 + 反馈）

```bash
orcode site         # 启动官网 http://localhost:8080
```

- **插件中心**：列出可下载插件，点「下载 .js」或复制 `plugin add` 命令安装。
- **反馈**：底部表单提交后落地到 `site/feedback.json`。

## 模型接入（OpenAI 兼容）

界面运行在终端的**独立窗口**（alternate screen buffer）里，退出后完全还原你原来的终端内容，
不会留下任何滚动残留；改变窗口大小会自动重排两栏布局。

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
下载第三方插件：在网页「插件中心」一键安装，或 `orcode plugin add <url>`
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
bin/orcode.js             CLI 入口（init/run/serve/site/config/...）
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
