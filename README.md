# Foundry Sandbox MCP Server

一个基于 Docker 的 Foundry 测试沙盒 MCP Server，允许 AI 在隔离的 Docker 容器中安全地运行 Foundry 测试命令。

## 功能特性

- ✅ **自动容器管理**: 每次测试时自动创建新容器，测试完成后自动清理
- ✅ **全新测试环境**: 每次测试都在全新的容器中运行，确保环境干净
- ✅ **多包管理器支持**: 支持 forge、npm、yarn 三种包管理器
- ✅ **灵活的依赖格式**: 支持数组格式（不带版本号）和对象格式（带版本号）
- ✅ **自动依赖安装**: 根据依赖清单文件自动安装依赖
- ✅ **Docker 缓存清理**: 测试完成后自动清理 Docker system 缓存
- ✅ **环境一致性**: 无论运行在 Mac、Windows 还是 Linux，行为完全一致
- ✅ **安全性**: 所有操作在 Docker 容器中运行，与宿主机隔离
- ✅ **零污染**: 所有依赖和缓存保留在容器内，测试完成后自动清理

## 前置要求

- Docker 和 Docker Compose
- Node.js 18+ 和 Yarn
- Foundry 项目

## 快速开始

### 安装

1. 克隆或下载项目

2. 安装依赖：

```bash
yarn install
```

3. 构建项目：

```bash
yarn build
```

### 配置 MCP 客户端

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
- `/absolute/path/to/foundry-mcp`: MCP Server 的安装路径（绝对路径）
- Docker 镜像会在首次使用时自动构建

### 开发模式

```json
{
  "mcpServers": {
    "foundry-sandbox": {
      "command": "yarn",
      "args": ["dev"],
      "cwd": "/absolute/path/to/foundry-mcp"
    }
  }
}
```

## 可用工具

### `forge_test`

在 Docker 容器中运行 `forge test` 命令。每次测试时创建新容器，测试完成后自动清理，确保全新环境。

**参数**:

- `projectRoot` (必需): 项目根路径（绝对路径），用于 Docker 挂载。例如 `/path/to/project`
- `testFolderPath` (必需): 测试合约文件夹路径（相对项目根路径）。例如 `test` 或 `test/unit`。如果路径以 `.sol` 结尾，则直接使用该路径；否则会自动匹配该文件夹下的所有 `.t.sol` 文件
- `dependenciesManifestPath` (必需): 依赖项清单文件路径（相对项目根路径）。文件格式为 JSON 对象，例如 `dependencies.json`
- `extraArgs` (可选): 额外的 `forge test` 参数数组

**工作流程**:

1. 创建新容器（使用唯一名称），挂载项目目录
2. 根据依赖清单文件自动安装依赖（forge、npm、yarn）
3. 在容器中运行 `forge test` 命令
4. 返回测试结果
5. 自动删除容器并清理 Docker system 缓存

## 依赖管理

### 依赖清单文件格式

依赖清单文件支持三种包管理器（forge、npm、yarn），每种包管理器支持两种格式：

#### 格式说明

1. **数组格式（不带版本号）**: `["package-name"]` - 使用最新版本
2. **对象格式（带版本号）**: `{"package-name": "version"}` - 指定版本

#### 示例

```json
{
  "forge": ["foundry-rs/forge-std"],
  "npm": {
    "@openzeppelin/contracts": "^5.0.2",
    "@openzeppelin/contracts-upgradeable": "^5.0.2"
  },
  "yarn": ["@chainlink/contracts"]
}
```

#### 详细说明

- **forge**: 使用 `forge install --no-git` 安装 Git 依赖
  - 数组格式：`["foundry-rs/forge-std"]`（使用最新版本）
  - 对象格式：`{"foundry-rs/forge-std": "v1.0.0"}`（指定版本或 tag）
  
- **npm**: 使用 `npm install` 安装 npm 包
  - 数组格式：`["@openzeppelin/contracts"]`（使用最新版本）
  - 对象格式：`{"@openzeppelin/contracts": "^5.0.2"}`（指定版本）
  
- **yarn**: 使用 `yarn add` 安装 yarn 包
  - 数组格式：`["@chainlink/contracts"]`（使用最新版本）
  - 对象格式：`{"@chainlink/contracts": "^1.0.0"}`（指定版本）

#### 注意事项

- 所有字段（forge、npm、yarn）都是可选的，但至少需要提供一个字段
- 每个字段可以独立选择使用数组或对象格式
- 支持混合格式（部分字段使用数组，部分字段使用对象）
- 版本号格式遵循各包管理器的标准格式

## Docker 环境管理

### 自动容器管理

**MCP Server 会自动管理 Docker 容器生命周期**：

- ✅ **每次测试时创建新容器**：使用唯一名称（基于时间戳），确保全新环境
- ✅ **自动挂载项目目录**：将传入的项目路径挂载到容器的 `/workspace` 目录
- ✅ **测试完成后自动清理**：删除容器并清理 Docker system 缓存
- ✅ **无需手动操作**：完全自动化，无需手动创建或删除容器

### Docker 镜像管理

**重要**：Docker 镜像 `foundry-sandbox:latest` 会在首次使用时自动构建。

如果镜像不存在，MCP 工具会自动：
1. 检测 MCP 服务器路径（通过环境变量 `FOUNDRY_MCP_PROJECT_PATH` 或自动查找）
2. 读取 `src/docker/Dockerfile.foundry` 和 `src/docker/docker-compose.yml` 配置
3. 使用 `docker-compose build` 自动构建 Docker 镜像

**手动构建**（可选）：
```bash
# 使用 docker-compose（推荐）
cd /path/to/foundry-mcp
docker-compose -f src/docker/docker-compose.yml build foundry-sandbox

# 或使用 docker build
docker build -t foundry-sandbox:latest -f src/docker/Dockerfile.foundry .
```

**设置 MCP 服务器路径**（可选，用于自动构建）：
```bash
export FOUNDRY_MCP_PROJECT_PATH=/path/to/foundry-mcp
```

**注意**：MCP 服务器目录必须同时包含 `src/docker/Dockerfile.foundry` 和 `src/docker/docker-compose.yml` 文件。

### Docker 镜像内容

Docker 镜像基于 `ghcr.io/foundry-rs/foundry:latest`，并包含：

- Foundry 工具集（forge, cast, anvil, chisel）
- Node.js 20.x
- npm
- yarn

## 使用示例

### 运行所有测试

```json
{
  "name": "forge_test",
  "arguments": {
    "projectRoot": "/absolute/path/to/project",
    "testFolderPath": "test",
    "dependenciesManifestPath": "dependencies.json"
  }
}
```

### 运行特定测试文件

```json
{
  "name": "forge_test",
  "arguments": {
    "projectRoot": "/absolute/path/to/project",
    "testFolderPath": "test/Counter.t.sol",
    "dependenciesManifestPath": "dependencies.json"
  }
}
```

### 使用额外参数

```json
{
  "name": "forge_test",
  "arguments": {
    "projectRoot": "/absolute/path/to/project",
    "testFolderPath": "test",
    "dependenciesManifestPath": "dependencies.json",
    "extraArgs": ["-vvv", "--gas-report"]
  }
}
```

## 工作原理

1. **MCP Server** 接收来自 AI 的工具调用请求
2. **Docker Manager** 创建新的 Docker 容器并挂载项目目录
3. **依赖安装** 根据依赖清单文件自动安装依赖（forge、npm、yarn）
4. **Forge Tool** 在容器中执行 `forge test` 命令
5. **结果返回** 命令输出（stdout/stderr）和退出码被捕获并返回给 AI
6. **清理** 自动删除容器并清理 Docker system 缓存

## 项目结构

```
foundry-mcp/
├── src/
│   ├── index.ts              # MCP Server 主文件
│   ├── docker-manager.ts     # Docker 容器管理
│   ├── docker/
│   │   ├── Dockerfile.foundry        # Foundry Docker 镜像
│   │   └── docker-compose.yml       # Docker Compose 配置
│   └── tools/
│       └── forge-tool.ts     # Forge 工具实现
├── dist/                     # 编译后的文件
├── dependencies.json         # 依赖清单示例文件
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

1. 检查 Docker 是否正在运行：
```bash
docker ps
```

2. 检查 Docker 镜像是否存在：
```bash
docker images | grep foundry-sandbox
```

3. 如果镜像不存在，MCP Server 会自动构建，或手动构建：
```bash
docker-compose -f src/docker/docker-compose.yml build foundry-sandbox
```

### Docker 未运行

确保 Docker Desktop 正在运行：

```bash
docker ps
```

### 依赖安装失败

1. 检查依赖清单文件格式是否正确
2. 检查网络连接（依赖需要从网络下载）
3. 查看 MCP Server 日志获取详细错误信息

### 权限问题

如果遇到权限问题，确保 Docker 有权限访问项目目录。

## 安全注意事项

- 所有操作在 Docker 容器中运行，与宿主机隔离
- 容器与宿主机通过卷挂载共享文件
- 测试完成后自动清理容器和缓存
- 建议在生产环境中使用只读卷挂载（如果需要）

## 许可证

MIT
