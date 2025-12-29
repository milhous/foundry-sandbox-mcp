# MCP 客户端配置指南

本文档说明如何在不同 MCP 客户端中配置 Foundry Sandbox MCP Server。

## Claude Desktop 配置

### macOS

编辑配置文件：

```bash
~/Library/Application Support/Claude/claude_desktop_config.json
```

### Windows

编辑配置文件：

```bash
%APPDATA%\Claude\claude_desktop_config.json
```

### 配置内容

```json
{
  "mcpServers": {
    "foundry-sandbox": {
      "command": "node",
      "args": ["/absolute/path/to/foundry-mcp/dist/index.js"]
    }
  }
}
```

**配置说明**:

- **`command`**: 要执行的命令（`node`）
- **`args`**: 命令参数，指向编译后的 MCP Server 入口文件
- **无需环境变量配置**：项目路径在调用工具时作为参数传入

**重要**:

- 将 `/absolute/path/to/foundry-mcp` 替换为 MCP Server 的实际绝对路径
- 确保已经运行 `yarn build` 构建项目
- **项目路径在工具调用时传入**，无需在配置中设置
- **Docker 容器会自动创建和启动**，无需手动运行 `docker-compose up -d`

### 开发模式配置（使用 tsx）

如果使用开发模式，可以使用：

```json
{
  "mcpServers": {
    "foundry-sandbox": {
      "command": "yarn",
      "args": ["dev"]
    }
  }
}
```

**注意**: 项目路径在工具调用时传入，无需在配置中设置环境变量。

## Cursor 配置

在 Cursor 的设置中，找到 MCP 服务器配置部分，添加：

```json
{
  "mcpServers": {
    "foundry-sandbox": {
      "command": "node",
      "args": ["/absolute/path/to/foundry-mcp/dist/index.js"]
    }
  }
}
```

**注意**: 项目路径在工具调用时作为 `projectPath` 参数传入，MCP Server 会自动管理 Docker 容器。

## 验证配置

配置完成后，重启客户端，然后尝试与 AI 对话：

```
User: 列出可用的工具
```

AI 应该能够看到 `forge_test`、`forge_build` 和 `forge_clean` 工具。

## 测试配置

尝试运行一个简单的测试：

```
User: 在沙盒中运行 /path/to/project 项目的测试
```

AI 会调用工具，传入项目路径：

```json
{
  "name": "forge_test",
  "arguments": {
    "projectPath": "/path/to/project"
  }
}
```

如果配置正确，AI 应该能够调用工具并返回结果。

## 理解项目路径配置

### 自动 Docker 管理

MCP Server 现在支持**自动管理 Docker 容器**：

- ✅ **自动创建容器**：如果容器不存在，会自动使用 `docker-compose` 创建
- ✅ **自动启动容器**：如果容器已停止，会自动启动
- ✅ **动态项目路径**：项目路径在工具调用时作为参数传入

### 项目路径传入方式

**在工具调用时传入项目路径**：

所有工具（`forge_test`、`forge_build`、`forge_clean`）都需要 `projectPath` 参数：

```json
{
  "name": "forge_test",
  "arguments": {
    "projectPath": "/absolute/path/to/your/foundry/project",
    "matchPath": "test/MyTest.t.sol"
  }
}
```

**优势**：

- ✅ 一个 MCP Server 可以处理多个不同的 Foundry 项目
- ✅ 无需在配置中绑定项目路径
- ✅ 更灵活，可以在运行时切换项目

### 如何获取正确的项目路径

**macOS/Linux**:

```bash
cd /path/to/your/foundry/project
pwd
```

**Windows (PowerShell)**:

```powershell
cd C:\path\to\your\foundry\project
pwd
```

**Windows (CMD)**:

```cmd
cd C:\path\to\your\foundry\project
cd
```

### 验证配置

配置完成后，可以通过以下方式验证：

1. 检查 MCP Server 启动日志（会显示服务器已启动）
2. 运行测试命令，如果路径错误会报错
3. 检查 Docker 容器是否自动创建和启动

## 常见问题

### 1. 找不到容器

**错误**: `Container 'foundry-sandbox' not found`

**解决**:

- MCP Server 现在会自动创建容器，如果仍然失败：
  - 检查工具调用时传入的 `projectPath` 参数是否正确
  - 确保项目目录中存在 `docker-compose.yml` 文件
  - 确保 `projectPath` 是绝对路径
  - 手动运行 `docker-compose up -d foundry-sandbox` 作为备选方案

### 2. Docker 未运行

**错误**: `Docker is not available`

**解决**: 启动 Docker Desktop

### 3. 路径错误

**错误**: `Cannot find module` 或 `ENOENT` 或 `Container not found`

**解决**:

- 检查工具调用时传入的 `projectPath` 参数是否为绝对路径
- **确保项目路径正确**：必须指向 Foundry 项目根目录（包含 `foundry.toml` 和 `docker-compose.yml` 的目录）
- 确保 `args` 中的路径指向编译后的 `dist/index.js` 文件
- 确保已运行 `yarn build`
- 如果项目路径设置错误，Docker 容器会挂载错误的目录

### 4. 权限问题

**错误**: 权限被拒绝

**解决**:

- 确保 Node.js 有执行权限
- 检查 Docker 权限设置

## 下一步

配置完成后，请参考 [README.md](./README.md) 了解如何使用各个工具。
