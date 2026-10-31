#!/bin/bash
# macOS: start local companion (voice-server) and remind to open the PS panel.
cd "$(dirname "$0")"
ROOT="$PWD"
PLUGIN="$ROOT/plugin"
TARGET="$HOME/Library/Application Support/Adobe/UXP/Plugins/External/com.local.lk888.psedit"

echo "局部改图 · macOS 助手"
if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js。请先安装：https://nodejs.org/"
  read -r -p "按回车关闭…"
  exit 1
fi

mkdir -p "$TARGET"
rsync -a --delete "$PLUGIN"/ "$TARGET"/
echo "已同步插件到 UXP External："
echo "  $TARGET"

# Free stale listener on 17402 if any
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -tiTCP:17402 -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${PIDS:-}" ]]; then
    echo "结束占用 17402 的旧进程：$PIDS"
    kill $PIDS 2>/dev/null || true
    sleep 0.5
  fi
fi

echo "启动本机助手（剪贴板可用；听写/拖入接图层在 macOS 为一期降级）…"
node "$ROOT/scripts/voice-server.cjs" &
HELPER_PID=$!
sleep 0.8
if kill -0 "$HELPER_PID" 2>/dev/null; then
  echo "助手已在 127.0.0.1:17402 运行 (pid $HELPER_PID)。"
else
  echo "助手可能因端口占用未能启动；若 Photoshop 已能连上可忽略。"
fi
echo
echo "请打开 Photoshop → 增效工具 →「局部改图」。"
echo "关闭本窗口不会自动结束助手；可在活动监视器结束 node，或：kill $HELPER_PID"
read -r -p "按回车关闭此窗口（助手继续在后台）…"
