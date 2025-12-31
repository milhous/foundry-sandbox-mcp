# Foundry Sandbox MCP Server

一个基于 Docker 的 Foundry 审计沙盒 MCP Server，允许 AI 在隔离的 Docker 容器中安全地运行 Foundry 命令。

## 功能特性

- ✅ **仅提供 forge_test**: 专注于测试功能，简化使用
- ✅ **自动容器管理**: 每次测试时自动创建新容器，测试完成后自动清理
- ✅ **全新测试环境**: 每次测试都在全新的容器中运行，确保环境干净
- ✅ **Foundry Sandbox 环境**: 提供干净的 Foundry 运行环境，包括测试文件支持
- ✅ **配置读取**: 通过 foundry.toml 读取项目配置（src、out、cache_path、libs 等）
- ✅ **动态项目路径**: 在工具调用时传入 foundry.toml 路径，支持多项目
- ✅ **文件热同步**: 通过 Docker 卷挂载实现项目文件实时同步
- ✅ **环境一致性**: 无论运行在 Mac、Windows 还是 Linux，行为完全一致
- ✅ **安全性**: FFI 功能在 Docker 容器中运行，比宿主机更安全
- ✅ **零污染**: 所有依赖和缓存保留在容器内，测试完成后自动清理
- ✅ **自动依赖管理**: 容器创建时自动检查并创建 libs 目录，当 forge 需要安装依赖时，自动安装到 foundry.toml 中配置的 libs 路径

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

**重要**：Docker 镜像 `foundry-sandbox:latest` 会在首次使用时自动构建。

如果镜像不存在，MCP 工具会自动：
1. 检测 MCP 服务器路径（通过环境变量 `FOUNDRY_MCP_PROJECT_PATH` 或自动查找）
2. 读取 `Dockerfile.foundry` 和 `docker-compose.yml` 配置
3. 使用 `docker-compose build` 自动构建 Docker 镜像

**手动构建**（可选）：
```bash
# 使用 docker-compose（推荐）
docker-compose build foundry-sandbox

# 或使用 docker build
docker build -t foundry-sandbox:latest -f Dockerfile.foundry .
```

**设置 MCP 服务器路径**（可选，用于自动构建）：
```bash
export FOUNDRY_MCP_PROJECT_PATH=/path/to/foundry-mcp
```

**注意**：MCP 服务器目录必须同时包含 `Dockerfile.foundry` 和 `docker-compose.yml` 文件。

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
- **无需配置项目路径**：项目路径在工具调用时作为 `foundryTomlPath` 参数传入（foundry.toml 文件的绝对路径）
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

- `foundryTomlPath` (必需): `foundry.toml` 文件的绝对路径。MCP 会根据此文件解析配置信息（src、out、cache_path、libs 等），并使用 foundry.toml 所在目录作为项目根目录
- `testPath` (可选): 测试路径匹配模式，例如 `"test/MyTest.t.sol"`
- `matchPath` (可选): 使用 `--match-path` 参数匹配测试文件路径（与 `testPath` 互斥）
- `extraArgs` (可选): 额外的 `forge test` 参数数组

**工作流程**:

1. 验证并解析 `foundry.toml` 文件，获取项目配置（src、out、cache_path、libs 等）
2. 检查 Docker 镜像是否存在（`foundry-sandbox:latest`）
3. 创建新容器（使用唯一名称），挂载项目目录
4. **自动检查并创建 libs 目录**：根据 foundry.toml 中的 libs 配置，检查目录是否存在，如果不存在则自动创建
5. 在容器中运行 `forge test` 命令（forge 会自动读取 foundry.toml 配置）
6. **依赖自动安装**：如果 forge 需要安装依赖，会自动安装到 foundry.toml 中配置的 libs 路径
7. 返回测试结果
8. 自动删除容器，确保下次测试是全新环境

**依赖管理**:

- MCP 会自动检查 foundry.toml 中配置的 libs 目录
- 如果 libs 目录不存在或为空，会自动创建目录
- 当 forge 需要安装依赖时，会自动安装到 libs 指定的文件夹中
- 依赖通过 Docker 挂载的文件夹同步到宿主机，确保持久化

**示例**:

```json
{
  "name": "forge_test",
  "arguments": {
    "foundryTomlPath": "/absolute/path/to/your/foundry/project/foundry.toml",
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
    "foundryTomlPath": "/path/to/project/foundry.toml"
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
    "foundryTomlPath": "/path/to/project/foundry.toml",
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
