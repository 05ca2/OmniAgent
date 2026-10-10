# ORcode 发布说明 (CHANGELOG)

## [1.0.0] - 2026-10-08

### 新增功能
- 🎯 **多模型协作编排** - 支持多岗位（Role）模型协同工作
- 🖥️ **终端交互模式** - 纯终端内的交互式 CLI，类似 opencode/claude code
- 🌐 **本地 Web 应用** - 在浏览器中使用（localhost:3000）
- 🌍 **官方官网** - 插件中心 + 反馈系统（localhost:8080）
- 🔌 **插件系统** - 动态加载文件/Shell/联网等插件
- 💬 **AI 对话界面** - 像素风格 + 双栏布局（左对话 + 右信息）

### 技术特性
- ⚡ **零第三方依赖** - 纯 Node.js 内置模块实现
- 🔑 **自带模型** - 支持任意 OpenAI 兼容协议
- 📊 **实时流水线** - 可视化展示各岗位协作过程
- 🎛️ **Mock 模式** - 无需密钥即可查看完整演示
- 🔒 **密钥安全** - 自动校验和脱敏显示
- 📁 **运行报告** - 自动保存 Markdown 格式执行报告

### 使用方法

```bash
# 初始化配置
node bin/orcode.js init

# 终端交互模式（推荐）
node bin/orcode.js

# Web 应用模式
node bin/orcode.js serve

# 官网（插件中心）
node bin/orcode.js site

# 单次执行任务
node bin/orcode.js run "用 Python 写个贪吃蛇"
```

### 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `/` | 命令面板 |
| `Tab` | 切换岗位 |
| `Ctrl+P` | 显示/隐藏命令面板 |
| `Esc` | 清空输入或中断当前任务 |
| `Ctrl+C` | 退出程序 |

### 会话命令

- `/mock` - 切换演示模式（无需密钥）
- `/model <id>` - 统一会话模型
- `/agents` - 循环切换岗位
- `/reload` - 重新加载配置
- `/status` - 查看状态
- `/plugins` - 列出已安装插件
- `/clear` - 清屏
- `/help` - 显示帮助
- `/exit` - 退出

### 许可证

MIT License

### 下载

从 [Releases](https://github.com/05ca2/ORcode/releases) 下载源码或直接克隆：

```bash
git clone https://github.com/05ca2/ORcode.git
```
