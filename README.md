# Photoshop 局部 AI 改图插件

Photoshop 内的简洁 UXP 面板，通过 https://api.lk888.ai 调用生图模型，使用 PS 原生选区完成局部修改。

## 功能

- 框选或套索读取选区，紧贴选区捕获参考画面并保留原选区蒙版。
- 添加、拖入或粘贴截图作为编号参考图。
- 输入修改要求，选择模型、清晰度、尺寸及 1–4 张结果。
- 多处改图可后台生成；顶部标签切换，关闭后在历史记录恢复。
- 结果点击添加独立图层，按原坐标和尺寸回填；允许重复添加。
- 图片右上角放大预览，预览内下载或右键保存原图。
- 设置页保存 API Key、刷新 API 模型列表及手动管理模型 ID。
- 语音按钮提示使用 Windows 的 Win+H 听写。

## 安装

需要 Photoshop 25.0 或更新版本。目前本机 Photoshop 27.6 已加载，用户已进行实际生成与图层回填；不同宿主和模型仍需自行验证。

1. 尝试双击 `dist/局部改图-LK888-0.1.0.ccx` 使用 Creative Cloud 安装。
2. 若本地 CCX 无法安装，通过 Adobe UXP Developer Tool 添加 `plugin/manifest.json`，点击 Load。
3. 在 PS 增效工具中打开面板，进入设置填写并保存自己的 LK888 API Key。
4. 在 RGB 文档选择区域，点击更新选区，输入要求后生成。
5. 生成完成后点击候选图添加图层。放大查看与添加操作分开。

密钥保存在本机 UXP secureStorage。模型列表可能包含聊天模型，只有平台支持的图像编辑模型才能完成改图。模型可用性、速度及费用以平台账号为准。一次生成多张会提交多个任务。

## 开发

核心测试无需额外依赖，使用 Node.js 执行：

```sh
node --test tests/api.test.cjs tests/panel.test.cjs tests/png.test.cjs
```

Windows 打包：

```powershell
./scripts/package.ps1
```

浏览器检查脚本使用 Playwright；本机版本引用了本地运行时路径，其他环境需调整引用。

## 边界

生成与添加图层分开。历史保存输入和结果，但导入时必须回到原文档，画布尺寸变化会阻止自动导入。输入图片和提示词发送到 LK888；图片下载不附带 API Key。原选区蒙版限制显示区域，模型可能改变区域内构图。输入 PNG 无损编码，结果保存模型原始文件；回填缩放和模型输出分辨率仍会影响显示细节。

## 来源与许可

选区捕获、坐标变换、智能对象和蒙版模块复用 [FromPS / ToPS](https://github.com/dgl-10/PhotoshopPlugin)，版本 `2fc17b33f1406e39b73cb09d2042fb6acb248a68`。项目保留其 CC BY-NC-SA 4.0 许可及商业使用说明，见 [LICENSE](LICENSE) 与 [来源说明](plugin/NOTICE.md)。本适配版供个人非商业使用。
