#!/bin/bash

# Foundry Sandbox MCP Server 设置脚本

set -e

echo "🚀 Foundry Sandbox MCP Server 设置脚本"
echo ""

# 检查 Docker 是否运行
echo "📦 检查 Docker 环境..."
if ! docker ps > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请启动 Docker Desktop"
    exit 1
fi
echo "✅ Docker 环境正常"

# 安装依赖
echo ""
echo "📥 安装依赖..."
yarn install

# 构建项目
echo ""
echo "🔨 构建项目..."
yarn build

# 启动 Docker 容器
echo ""
echo "🐳 启动 Docker 容器..."
docker-compose up -d foundry-sandbox

# 验证容器运行
echo ""
echo "🔍 验证容器状态..."
if docker ps | grep -q foundry-sandbox; then
    echo "✅ 容器运行正常"
else
    echo "❌ 容器未运行，请检查 docker-compose.yml 配置"
    exit 1
fi

echo ""
echo "✨ 设置完成！"
echo ""
echo "下一步："
echo "1. 编辑 MCP 客户端配置文件（参考 MCP_CONFIG.md）"
echo "2. 重启 MCP 客户端"
echo "3. 开始使用 Foundry Sandbox MCP Server"

