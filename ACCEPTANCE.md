# 验收：生图提交超时与 Banana 2.1

## 原因

截图里的红字是 `plugin/api.js` 对「带正文的网络 / abort / timeout」的统一包装：

「提交生图任务时网络连接失败或超时。提交结果不确定，请到平台确认任务，勿重复生成。」

核对后的原因不是文案，而是提交路径本身：

1. 插件在使用真实 `fetch` 时，把 `/v1/media/generate` 改送到 `http://127.0.0.1:17402/media/generate`。本机语音服务没有这个接口。助手没开时连接直接被拒绝；助手开着时，选区图和参考图的 base64 还在上传，服务端已经按未知路由结束连接。请求没有到达 LK888，平台上不会有这次任务，但错误被说成「结果不确定，勿重复生成」。
2. 同一个 `catch` 把「连接还没建立」和「请求已经发出、响应没读回来」收成同一句。业务错误里只要出现英文 timeout / network / fetch / abort，也会被盖掉。超时后如果响应里其实有 `task_id`，编号不会写入历史。
3. 提交只有一个 5 分钟的 `AbortController`。大图 base64 上传和等待平台接单共用这个时限，时间一到就 abort，任务编号来不及保存。
4. Banana 2.1 已经写在推荐列表里（`banana-2.1`，按次，不是 `-token` / `flare` / `sunburst`），但面板下拉没有它：静态菜单没写这一项；已经勾选过模型的安装不会补上它；只要有任意模型测过，没测过的推荐项会被从主面板拿掉。

## 这次改了什么

- 生图直连 `https://api.lk888.ai/v1/media/generate`，带原来的 Bearer 密钥。不再把密钥和图片交给本机语音端口。语音助手没开也能提交。
- 分阶段超时：等到响应头至少 8 分钟，并按参考图体积加长，上限 15 分钟；读 JSON 再给 90 秒。查询任务、余额、模型列表仍是 60 秒。
- 连接被拒绝、DNS 失败、断网（请求确定没发出）标记为「没有发出，可以重新生成」，同一条提交最多自动再试 2 次。试成后保存返回的 `task_id`。
- 请求已经交给网络之后的超时、中断、含糊的 `network lost`，仍是「结果不确定，勿重复生成」，并且不自动重试，避免平台已经建单又被再提交一次。
- 平台返回的业务原因按原文显示。响应里如果已经有 `task_id`，写入该任务并继续查询，不丢掉编号。
- 主面板模型按次从便宜到贵：GPT 图 2.5、GPT 图 2、Banana 2.1、Banana 2、Banana Pro，然后是即梦 5.0 Pro（0.3024/次）和 Grok 图。默认勾选。老的勾选列表会补上 Banana 2.1 一次。推荐模型即使测试失败也留在下拉里。检查连接不拉取 LK888 全量列表，`-token` / `flare` / `sunburst` 不算 Banana 2.1 的按次版本。

## 怎么验收

1. 在 Photoshop 里重载插件：UXP Developer Tool 对 `plugin/manifest.json` 点 Reload，或在面板右上角点 ↻。要加载的是这份 `plugin/` 源码，不要继续用旧的 `dist/*.ccx`。
2. 打开模型下拉，应能看到 **Banana 2.1**，排在 Banana 2 前面；Banana Pro 后面是即梦 5.0 Pro 和 Grok 图。没有带 token、flare、sunburst 的重复项。
3. 选 **Banana 2.1**。添加至少一张参考图（可以是截图里的人物图），修改要求可以很长。清晰度自动、1 张、尺寸原图，点 **生成**。
4. 正常网络下，状态应变成已提交，历史里出现任务编号，并开始出图。不应再出现红字「提交生图任务时网络连接失败或超时。提交结果不确定，请到平台确认任务，勿重复生成。」本机「打开局部改图插件.cmd」没运行时，这一步也应能提交。
5. 若红字是「没有发出……可以重新生成」，平台上不会有这次任务，可以再点一次生成。
6. 若红字仍是「结果不确定……勿重复生成」，先到 LK888 看有没有刚创建的任务。有编号就在历史里查询，不要马上再点生成。

开发机可先跑：

```sh
node --test tests/api.test.cjs tests/model-manager.test.cjs tests/generation-failure.test.cjs tests/panel.test.cjs tests/png.test.cjs tests/voice.test.cjs tests/prompt-editor.test.cjs tests/optimizer.test.cjs tests/geometry.test.cjs tests/ps-placement.test.cjs
```
