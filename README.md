# Foundry Sandbox MCP Server

一个基于 Docker 的 Foundry 审计沙盒 MCP Server，允许 AI 在隔离的 Docker 容器中安全地运行 Foundry 命令。

## 功能特性

- ✅ **仅提供 forge_test**: 专注于测试功能，简化使用
- ✅ **自动容器管理**: 每次测试时自动创建新容器，测试完成后自动清理
- ✅ **全新测试环境**: 每次测试都在全新的容器中运行，确保环境干净
- ✅ **动态项目路径**: 在工具调用时传入项目路径，支持多项目
- ✅ **文件热同步**: 通过 Docker 卷挂载实现项目文件实时同步
- ✅ **环境一致性**: 无论运行在 Mac、Windows 还是 Linux，行为完全一致
- ✅ **安全性**: FFI 功能在 Docker 容器中运行，比宿主机更安全
- ✅ **零污染**: 所有依赖和缓存保留在容器内，测试完成后自动清理

## 前置要求

- Docker 和 Docker Compose
- Node.js 18+ 和 Yarn
- Foundry 项目（包含 `foundry.toml` 配置文件）

## 快速开始

### 方式一：使用设置脚本（推荐）

```bash
./scripts/setup.sh
```

脚本会自动完成：

- 检查 Docker 环境
- 安装依赖
- 构建项目
- 启动 Docker 容器

### 方式二：手动安装

1. 克隆或下载项目

2. 安装依赖：

```bash
yarn install
```

3. 构建项目：

```bash
yarn build
```

## Docker 环境管理

### 自动容器管理

**MCP Server 会自动管理 Docker 容器生命周期**：

- ✅ **每次测试时创建新容器**：使用唯一名称（基于时间戳），确保全新环境
- ✅ **自动挂载项目目录**：将传入的项目路径挂载到容器的 `/workspace` 目录
- ✅ **测试完成后自动清理**：删除容器，确保每次测试都在全新环境中运行
- ✅ **无需手动操作**：完全自动化，无需手动创建或删除容器

**重要**：确保 Docker 镜像 `foundry-sandbox:latest` 已构建。如果不存在，请运行：

```bash
docker build -t foundry-sandbox:latest -f Dockerfile.foundry .
```

### 启动 Anvil 节点（可选）

如果需要本地测试节点，可以使用 docker-compose：

```bash
docker-compose up -d anvil
```

Anvil 将在以下端口运行：

- `8545`: HTTP RPC
- `8546`: WebSocket RPC

## 配置 MCP 客户端

### 配置方式

**重要更新**: MCP Server 现在支持在工具调用时传入项目路径，无需在配置中设置环境变量。

#### Claude Desktop 配置

编辑配置文件：

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

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

#### Cursor 配置

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

- `/absolute/path/to/foundry-mcp`: MCP Server 的安装路径
- **无需配置项目路径**：项目路径在工具调用时作为 `projectPath` 参数传入
- **Docker 容器会自动创建和启动**，无需手动运行 `docker-compose up -d`

### 开发模式

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

详细配置说明请参考 [MCP_CONFIG.md](./MCP_CONFIG.md)

## 可用工具

### `forge_test`

在 Docker 容器中运行 `forge test` 命令。每次测试时创建新容器，测试完成后自动清理，确保全新环境。

**参数**:

- `projectPath` (必需): Foundry 项目根路径（包含 `foundry.toml` 的目录），必须是绝对路径
- `testPath` (可选): 测试路径匹配模式，例如 `"test/MyTest.t.sol"`
- `matchPath` (可选): 使用 `--match-path` 参数匹配测试文件路径（与 `testPath` 互斥）
- `extraArgs` (可选): 额外的 `forge test` 参数数组

**工作流程**:

1. 检查 Docker 镜像是否存在（`foundry-sandbox:latest`）
2. 创建新容器（使用唯一名称），挂载项目目录
3. 在容器中运行 `forge test` 命令
4. 返回测试结果
5. 自动删除容器，确保下次测试是全新环境

**示例**:

```json
{
  "name": "forge_test",
  "arguments": {
    "projectPath": "/absolute/path/to/your/foundry/project",
    "matchPath": "test/MyTest.t.sol"
  }
}
```

## 使用示例

### 运行所有测试

```
User: 在沙盒里运行 /path/to/project 项目的所有测试，并告诉我结果。
```

Agent 将调用 `forge_test` 工具，返回测试结果：

```json
{
  "name": "forge_test",
  "arguments": {
    "projectPath": "/path/to/project"
  }
}
```

### 运行特定测试

```
User: 运行 /path/to/project 项目中 test/MyTest.t.sol 的测试。
```

Agent 将调用 `forge_test` 工具，参数为：

```json
{
  "name": "forge_test",
  "arguments": {
    "projectPath": "/path/to/project",
    "matchPath": "test/MyTest.t.sol"
  }
}
```

## 工作原理

1. **MCP Server** 接收来自 AI 的工具调用请求
2. **Docker Manager** 确保 Docker 容器正在运行
3. **Forge Tool** 在容器中执行相应的 `forge` 命令
4. 命令输出（stdout/stderr）和退出码被捕获并返回给 AI
5. AI 解析结果并向用户报告

## 项目结构

```
foundry-mcp/
├── src/
│   ├── index.ts              # MCP Server 主文件
│   ├── docker-manager.ts     # Docker 容器管理
│   └── tools/
│       └── forge-tool.ts     # Forge 工具实现
├── Dockerfile.foundry        # Foundry Docker 镜像
├── docker-compose.yml        # Docker Compose 配置
├── foundry.toml              # Foundry 配置文件
├── package.json
├── tsconfig.json
└── README.md
```

## 开发

### 开发模式

```bash
yarn dev
```

### 构建

```bash
yarn build
```

### 运行

```bash
yarn start
```

## 故障排除

### Docker 容器未找到

**MCP Server 现在会自动创建容器**。如果仍然失败：

1. 检查 `FOUNDRY_PROJECT_PATH` 环境变量是否正确设置
2. 确保项目目录中存在 `docker-compose.yml` 文件
3. 手动运行作为备选方案：

```bash
docker-compose up -d foundry-sandbox
```

### Docker 未运行

确保 Docker Desktop 正在运行：

```bash
docker ps
```

### 项目路径错误

如果遇到路径相关错误：

1. 检查 `FOUNDRY_PROJECT_PATH` 环境变量是否为绝对路径
2. 确保路径指向包含 `foundry.toml` 的项目根目录
3. 查看 MCP Server 启动日志，确认使用的项目路径

### 权限问题

如果遇到权限问题，确保 Docker 有权限访问项目目录。

### 端口冲突

如果 Anvil 端口被占用，修改 `docker-compose.yml` 中的端口映射。

## 安全注意事项

- FFI 功能在 Docker 容器中运行，比在宿主机上更安全
- 容器与宿主机隔离，但通过卷挂载共享文件
- 建议在生产环境中使用只读卷挂载（如果需要）

## 许可证

MIT
