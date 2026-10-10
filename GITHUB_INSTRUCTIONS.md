# ORcode 如何发布到 GitHub

## 第一步：在 GitHub 上创建新仓库

1. **访问 GitHub**：https://github.com/new
2. **填写仓库信息**：
   - Repository name: `orcode`（或其他名字）
   - Description: `多模型协作智能体开发工具 - Multi-model orchestration CLI`
   - **Public**（公开）或 **Private**（私有）
   - **不要** 勾选 "Initialize this repository with a README"（因为你已经有 README 了）
   - **不要** 勾选 "Add .gitignore" 或 "Add license"（我们自己有配置）

3. **点击 "Create repository"**

## 第二步：将本地代码推送到 GitHub

GitHub 创建仓库后，会显示一个 GitHub CLI 命令，复制它。但在转发之前，需要先设置你的 GitHub 用户凭据。

### 设置 Git 用户信息（首次）

```bash
git config --global user.name "你的GitHub用户名"
git config --global user.email "你的GitHub邮箱"
```

### 配置 GitHub 个人访问令牌（如果使用 HTTPS）

```bash
git config --global credential.helper wincred
```

然后运行：

```bash
git push -u origin master
```

在提示时：
- **Username**: 你的 GitHub 用户名
- **Password**: 你的 GitHub 个人访问令牌 (PAT)，不是登录密码

**如果没有 PAT**，可以通过以下方式创建：
1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token (classic)"
3. 选择作用域：`repo` (完整控制私有仓库)
4. 生成令牌
5. 保存令牌（以后使用）

### 或者：使用 SSH（推荐）

```bash
# 生成 SSH 密钥（如果还没有）
ssh-keygen -t ed25519 -C "your_email@example.com"

# 将公钥添加到 GitHub
# 复制内容：cat ~/.ssh/id_ed25519.pub
# 然后到 GitHub Settings -> SSH and GPG keys 添加

# 设置 SSH 认证
git config --global credential.helper store

# 推送仓库（SSH URL）
git remote add origin git@github.com:username/orcode.git
git push -u origin master
```

## 第三步：验证推送

```bash
# 查看远程仓库
git remote -v

# 查看提交历史
git log --oneline --graph --all
```

## 后续：向他人分发

复制你的 GitHub 仓库地址，其他人可以：

```bash
git clone https://github.com/username/orcode.git
cd orcode

# 直接运行，无需 npm install！
node bin/orcode.js init
node bin/orcode.js
```

## 常见问题

**Q: 推送失败 "permission denied (publickey)"**
A: 使用 HTTPS 推送而不是 SSH

**Q: 推送失败 "Authentication failed"**
A: 使用个人访问令牌 (PAT) 而不是登录密码

**Q: 如何分享给不 technical 的用户？**
A: 创建一个 Releases 页面，发布仓库的 zip 包

**Q: 如何添加贡献者？**
A: 进入仓库 Settings -> Manage access，添加合作者

## 下一步建议

1. **创建主要分支**：`git branch -m master main`
2. **设置默认分支**：在 GitHub 仓库设置中设置 `main`
3. **添加 README 和其他文档**：更新 README.md 提供详细使用说明
4. **创建标签**：`git tag v1.0.0`
