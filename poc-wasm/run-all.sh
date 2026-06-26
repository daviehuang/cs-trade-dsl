#!/usr/bin/env bash
# 路线 B 真身：单一 kernel.wasm 在 Node(UI/BFF) 与 JVM(中台/Chicory) 跑出逐位一致结果
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
CP="$HERE/lib/runtime-1.7.5.jar:$HERE/lib/wasm-1.7.5.jar"   # Windows 用 ';' 分隔

echo "╔══════════════════════════════════════════════════════════╗"
echo "║ 0) 单源编译：kernel.wat → kernel.wasm                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
( cd "$HERE" && [ -d node_modules ] || npm install --silent; node build.mjs )

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║ 1) 宿主 A：Node（UI/BFF）加载 kernel.wasm                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
( cd "$HERE" && node run-node.mjs )

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║ 2) 宿主 B：JVM（中台）经 Chicory 加载【同一个】kernel.wasm  ║"
echo "╚══════════════════════════════════════════════════════════╝"
( cd "$HERE/java" && javac -cp "$CP" RunWasm.java && java -Dstdout.encoding=UTF-8 -cp "$CP:." RunWasm )

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║ 3) 裁决：同一 wasm，Node vs JVM 逐条比对                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
node "$HERE/compare.mjs"
