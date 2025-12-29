#!/bin/bash

# 测试脚本：验证 MCP Server 功能

set -e

echo "🧪 Foundry Sandbox MCP Server 测试"
echo ""

PROJECT_PATH="/Users/zhangxiao/Documents/work/mcp/foundry-mcp"
MCP_SERVER_PATH="$PROJECT_PATH/dist/index.js"

# 检查构建
if [ ! -f "$MCP_SERVER_PATH" ]; then
    echo "❌ MCP Server 未构建，正在构建..."
    cd "$PROJECT_PATH"
    yarn build
fi

echo "✅ MCP Server 已构建"
echo ""

# 测试环境变量读取
echo "📋 测试环境变量读取..."
export FOUNDRY_PROJECT_PATH="$PROJECT_PATH"

# 检查 Docker 是否运行
echo "🐳 检查 Docker 环境..."
if ! docker ps > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请启动 Docker Desktop"
    exit 1
fi
echo "✅ Docker 环境正常"
echo ""

# 测试 MCP Server 启动（短暂运行以检查初始化）
echo "🚀 测试 MCP Server 初始化..."
timeout 5 node "$MCP_SERVER_PATH" 2>&1 || true

echo ""
echo "✨ 测试完成！"
echo ""
echo "下一步："
echo "1. 配置 MCP 客户端（参考 MCP_CONFIG.md）"
echo "2. 使用环境变量 FOUNDRY_PROJECT_PATH 指定项目路径"
echo "3. MCP Server 会自动管理 Docker 容器"

