# 另一台电脑安装说明（Photoshop 局部改图）

## 方式 A：跟影词魔方一起装（推荐）

1. 打开 https://github.com/383158353-sys/cine-prompt/releases
2. 下载并安装最新 `CinePrompt-Photoshop-Windows.exe`
3. 打开 Photoshop → 增效工具 → 打开「局部改图」面板
4. 在面板设置里填写自己的 LK888 API Key（只保存在本机）

## 方式 B：只装本插件

1. `git clone https://github.com/383158353-sys/ps-local-edit.git`
2. 任选其一：
   - 双击 `dist/局部改图-LK888-0.1.2.ccx`（Creative Cloud 可装时）
   - 或用 Adobe UXP Developer Tool 添加 `plugin/manifest.json` → Load
   - 或在 PowerShell 运行：`./scripts/install-plugin-autoload.ps1`（登录后自动向 PS 注册开发版插件）
3. 也可双击根目录 `打开局部改图插件.cmd`（会启动本机语音助手并加载插件）

## 要求

- Photoshop 25.0+（本机验证过 27.6）
- Windows（语音/剪贴板助手依赖本机脚本）
- 不要提交或拷贝含 API Key 的 `.env` / 本机 secureStorage 导出

## 仓库

- 源码与打包脚本在 `main`
- 插件本体在 `plugin/`
