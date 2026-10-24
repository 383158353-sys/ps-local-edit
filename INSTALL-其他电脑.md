# 另一台电脑安装说明（Photoshop 局部改图）

## 方式 A：跟影词魔方一起装（推荐）

1. 打开 https://github.com/383158353-sys/cine-prompt/releases
2. 下载并安装最新 `CinePrompt-Photoshop-Windows.exe`
3. 打开 Photoshop → 增效工具 → 打开「局部改图」面板
4. 在面板设置里填写自己的 LK888 API Key（只保存在本机）

## 方式 B：只装本插件

1. `git clone https://github.com/383158353-sys/ps-local-edit.git`
2. 任选其一：
   - 双击 `dist/局部改图-LK888-0.1.6.ccx`（Creative Cloud 可装时）
   - 或用 Adobe UXP Developer Tool 添加 `plugin/manifest.json` → Load
   - 或在 PowerShell 运行：`./scripts/install-plugin-autoload.ps1`（登录后自动向 PS 注册开发版插件）
3. 也可双击根目录 `打开局部改图插件.cmd`（会启动本机语音助手并加载插件）

## 覆盖已经装进 Photoshop 的 External 插件

正式包要盖过本机热修时，先完全退出 Photoshop，再把新 ccx 里的文件解压覆盖：

`%APPDATA%\Adobe\UXP\Plugins\External\com.local.lk888.psedit`

覆盖后该目录根上应能看到 `manifest.json`（当前版本 0.1.6），而不是多套一层 `plugin` 文件夹。然后双击仓库里的 `打开局部改图插件.cmd`，让本机助手监听 `127.0.0.1:17402`。只更新 ccx、不启动助手时，面板仍可粘贴和点「添加图片」；从资源管理器拖入若 UXP 读不到文件，会提示本机拖入服务未开启。

验收：

1. 在面板「修改要求」里 Ctrl+V 一段文字，只出现一次。
2. 点「粘贴图片」或 Ctrl+V 一张截图，参考图增加一张。
3. 从资源管理器把 PNG、JPG 或 WebP 拖到「拖入图片新增」或参考图那一行。能直接读到就立刻出现；读不到时弹出「局部改图 · 拖入图片」，再把同一张图拖进这个窗口，松手后面板出现这张参考图。
4. 拖入失败时不要再出现「该来源没有提供可读取的图片」，也不要出现「语音会话已结束」。

## 要求

- Photoshop 25.0+（本机验证过 27.6）
- Windows（语音/剪贴板助手依赖本机脚本）
- 不要提交或拷贝含 API Key 的 `.env` / 本机 secureStorage 导出

## 仓库

- 源码与打包脚本在 `main`
- 插件本体在 `plugin/`
