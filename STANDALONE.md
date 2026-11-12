# 局部改图独立助手

安装位置默认 `%LOCALAPPDATA%\PSLocalEditHelper`，插件仍在 `%APPDATA%\Adobe\UXP\Plugins\External\com.local.lk888.psedit`，插件 ID 不变。

- 首次安装：运行 `install-standalone.ps1`。完整包带 runtime/node.exe；源码安装也可自动发现本机 Node.js 或使用 -NodePath。
- 平时使用：从 Photoshop「增效工具」打开「局部改图」。登录后助手自动后台启动，无需启动影词魔方。
- 助手意外退出：面板会尝试通过本机协议启动；也可双击安装目录 `start-helper.vbs`。
- 助手监听 127.0.0.1:17402，监督进程负责故障重启。拖入、文件选择、剪贴板、标注、现有语音接口保留。
- 生图提交后台也已独立到 17402。影词优化入口仍是可选功能，仅点击优化时需要影词。
- 安装只更新程序文件，不清理 UXP secureStorage、localStorage 或历史数据。不读取、修改影词 API 配置。
- 旧版影词入口已补丁为优先使用独立助手与独立插件，防止再次覆盖或占用助手端口；保留旧代码备份。

当前修复包括拖入接图几何数据及独立生命周期。真实拖入验收仍以 Windows/PS 面板实际收到图片为准，测试通过或 helper ready 不代表实际拖入成功。
