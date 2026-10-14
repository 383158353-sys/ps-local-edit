# 来源与范围

选区捕获、坐标变换、智能对象和蒙版回填复用 FromPS / ToPS 的 modules 目录。
上游：https://github.com/dgl-10/PhotoshopPlugin
复用版本：2fc17b33f1406e39b73cb09d2042fb6acb248a68
上游作者与许可见 LICENSE-UPSTREAM.txt。改造版为个人使用，未作为商业服务发布。
新增内容：中文精简面板，以及 LK888 media 接口适配。
对 ps.js 的小幅修改：等待取消选区完成；临时文档关闭后激活原文档；导入失败时回滚本次历史；允许跳过上游自动添加的图像模糊。
接口协议参考：https://github.com/Corkery520/ComfyUI-MengBaoAI/blob/main/api/image_client.py

版本 0.1.0 已在本机 Photoshop 27.6 加载，用户已进行实际生成与回填；不同宿主及模型需另行验证。
即梦模型 ID 未确认，需在「设置」中按平台文档填写。


PNG compression includes fflate 0.8.2 by Arjun Barrett (MIT), distributed in lib/fflate.js. License: lib/fflate-LICENSE.txt. Source: https://github.com/101arrowz/fflate/tree/v0.8.2

LK888 模型参数适配另参考同一项目的节点实现（2026-10-14 核对）：
https://github.com/Corkery520/ComfyUI-MengBaoAI/blob/main/nodes/image_api/generate.py
固定尺寸与字段映射独立实现于 platform-profiles.js，模型实际支持情况以平台为准。

0.3.5 开始，平台模型名、参数定义和选项值直接依据平台公开文档（核对日期 2026-10-14）：
https://eat.lk888.ai/apidoc
公开文档配置明确返回 base_url=https://api.lk888.ai。platform-models.js 仅保留事实性参数信息，不含文档长篇说明、密钥或账号数据。
