# 另一台电脑安装说明（Photoshop 局部改图）

## 方式 A：跟影词魔方一起装（推荐）

1. 打开 https://github.com/383158353-sys/cine-prompt/releases
2. 下载并安装最新 `CinePrompt-Photoshop-Windows.exe`
3. 打开 Photoshop → 增效工具 → 打开「局部改图」面板
4. 在面板设置里填写自己的 LK888 API Key（只保存在本机）

## 方式 B：只装本插件

1. `git clone https://github.com/383158353-sys/ps-local-edit.git`
2. 任选其一：
   - 双击 `dist/局部改图-LK888-0.1.8.ccx`（Creative Cloud 可装时）
   - 或用 Adobe UXP Developer Tool 添加 `plugin/manifest.json` → Load
   - 或在 PowerShell 运行：`./scripts/install-plugin-autoload.ps1`（登录后自动向 PS 注册开发版插件）
3. 也可双击根目录 `打开局部改图插件.cmd`（会启动本机语音助手并加载插件）

## 覆盖已经装进 Photoshop 的 External 插件

正式包要盖过本机热修时，先完全退出 Photoshop，再把新 ccx 里的文件解压覆盖：

`%APPDATA%\Adobe\UXP\Plugins\External\com.local.lk888.psedit`

覆盖后该目录根上应能看到 `manifest.json`（当前版本 0.1.8），而不是多套一层 `plugin` 文件夹。

只覆盖 External 不够。拖放接图层在仓库里，不在 External 里。本机仓库若在 `D:\PS2025\ps-local-edit`，要同时更新：

- `D:\PS2025\ps-local-edit\plugin`（或用上面的 ccx 覆盖 External）
- `D:\PS2025\ps-local-edit\scripts\voice-server.cjs`
- `D:\PS2025\ps-local-edit\scripts\drop-overlay.ps1`
- `D:\PS2025\ps-local-edit\scripts\open-plugin.ps1`

入口仍是仓库根目录的 `打开局部改图插件.cmd`。助手启动时就会常驻接图层，拖到面板上时它立刻盖住光标附近（半透明蓝块，写着「松手即可添加参考图」）。面板不再弹出「局部改图 · 拖入图片」。

如果 17402 上已经有旧的 node，cmd 不会把它换掉，并会提示旧助手没有这次的接图层。先结束占用 17402 的旧进程，再双击 cmd，等它跑完（它会等接图层就绪），然后重载面板。

验收：

1. 在面板「修改要求」里 Ctrl+V 一段文字，只出现一次。
2. 点「粘贴图片」或 Ctrl+V 一张截图，参考图增加一张。点「添加图片」仍能选文件。
3. 从资源管理器把 PNG、JPG 或 WebP 拖到「拖入图片新增」或参考图那一行，看到蓝块后停一下再松开。参考图增加，不要弹出「局部改图 · 拖入图片」。
4. 拖入失败时不要出现「该来源没有提供可读取的图片」或「语音会话已结束」。助手没开时，只提示可粘贴或点「添加图片」。

## 要求

- Photoshop 25.0+（本机验证过 27.6）
- Windows（语音/剪贴板助手依赖本机脚本）
- 不要提交或拷贝含 API Key 的 `.env` / 本机 secureStorage 导出

## 仓库

- 源码与打包脚本在 `main`
- 插件本体在 `plugin/`
