#!/bin/sh
# 回送・納車依頼ボード（Node.js版）を起動します
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。Node.js をインストールしてから実行してください。"
  exit 1
fi
exec node server.js
