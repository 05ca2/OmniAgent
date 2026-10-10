#!/usr/bin/env node
/**
 * Create a GitHub Release for OmniAgent
 * Usage: node create-release.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 配置
const OWNER = '05ca2';
const REPO = 'OmniAgent';
const VERSION = '1.0.0';
const TAG_NAME = `v${VERSION}`;
const EXISTS_TAG = false;

console.log(`🚀 准备创建 GitHub Release: ${OWNER}/${REPO}@${TAG_NAME}`);

/**
 * 读取 CHANGELOG.md 内容
 */
function getChangelogBody() {
  try {
    const changelogPath = path.join(__dirname, 'CHANGELOG.md');
    const changelog = readFileSync(changelogPath, 'utf-8');
    // 提取第一个版本的说明内容
    const match = changelog.match(/## \[1\.0\.0\] - 2026-10-08[\s\S]*?### 下载/s);
    if (match) {
      return match[0].trim();
    }
    return changelog.slice(0, 1000);
  } catch (err) {
    console.error('读取 CHANGELOG 失败:', err.message);
    return `OmniAgent ${VERSION} - 首个 Alpha 版本`;
  }
}

/**
 * 通过 GitHub API 创建 Release
 */
async function createRelease() {
  const headers = {
    'Authorization': `token ${process.env.GITHUB_TOKEN || ''}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'OmniAgent-Release-Script',
  };

  const body = {
    tag_name: TAG_NAME,
    target_commitish: 'master',  // 使用 master 分支
    name: `OmniAgent ${VERSION}`,
    body: getChangelogBody(),
    draft: false,
    prerelease: true  // 标为预览版
  };

  // 先尝试获取现有 Release 列表
  const checkUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;
  
  console.log('📋 检查现有 Release...');
  try {
    const checkRes = await fetch(checkUrl, { headers });
    const releases = await checkRes.json();
    
    const existing = releases.find(r => r.tag_name === TAG_NAME);
    if (existing) {
      console.log('⚠️ 发现重复 Release，准备更新...');
      console.log(`   ID: ${existing.id}, URL: ${existing.html_url}`);
      // 删除现有 Release 然后重新创建
      const deleteUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases/${existing.id}`;
      const delRes = await fetch(deleteUrl, { 
        headers, 
        method: 'DELETE' 
      });
      
      if (!delRes.ok) {
        throw new Error(`删除现有 Release 失败: ${delRes.status}`);
      }
      console.log('✅ 已删除现有 Release');
    }
  } catch (err) {
    console.log('📝 创建新的 Release...');
  }

  // 创建新 Release
  const createUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;
  
  try {
    const createRes = await fetch(createUrl, {
      headers,
      method: 'POST',
      body: JSON.stringify(body)
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`GitHub API 错误: ${createRes.status} - ${errText}`);
    }

    const result = await createRes.json();
    console.log('✅ Release 创建成功！');
    console.log(`📍 URL: ${result.html_url}`);
    console.log(`   Tag: ${result.tag_name}`);
    console.log(`   标题: ${result.name}`);
    console.log(`   状态: ${result.draft ? 'Draft' : 'Published'}`);
    return result;
  } catch (err) {
    console.error('❌ Release 创建失败:');
    console.error(err.message);
    
    // 详细错误信息
    if (err.message.includes('403')) {
      console.error('⚠️  权限错误：请检查 PAT 是否有仓库写入权限');
    } else if (err.message.includes('404')) {
      console.error('⚠️  仓库不存在或 PAT 权限不足');
    } else {
      console.error('💡  可能性:');
      console.error('   1. 检查 PAT 是否无效');
      console.error('   2. 仓库是否公开');
      console.error('   3. 网络是否被阻止');
    }
    process.exit(1);
  }
}

// 执行
createRelease().then(result => {
  // 显示项目的当前 Git 状态
  console.log('\n📊 项目状态:');
  const { execSync } = require('child_process');
  try {
    const log = execSync('git log --oneline -3', { encoding: 'utf8' });
    console.log('最近提交:');
    console.log(log);
    
    const status = execSync('git status', { encoding: 'utf8' });
    console.log('\n仓库状态:');
    console.log(status);
  } catch (err) {
    console.log('无法获取 Git 状态');
  }

  // 显示如何使用
  console.log('\n🎯 下载方式:');
  console.log('1. 访问项目 Release 页面');
  console.log(`   https://github.com/${OWNER}/${REPO}/releases/tag/${TAG_NAME}`);
  console.log('2. 下载源码 ZIP 或克隆仓库');
  console.log('3. 运行：node bin/orcode.js init');
  console.log('4. 运行：node bin/orcode.js');
}).catch(err => {
  console.error('❌ 主流程错误:', err);
  process.exit(1);
});
