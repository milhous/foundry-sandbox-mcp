# Foundry MCP Server

一个 MCP (Model Context Protocol) 服务器，用于在 Docker 容器中运行 Foundry 命令。该服务器作为 AI 和 Foundry 沙盒环境之间的中介，将 AI 的指令转换为 Docker 容器内的 `forge` 命令，并将执行结果返回给 AI。

## 功能特性

- 🐳 **Docker 沙盒环境**: 在隔离的 Docker 容器中运行 Foundry 命令
- 🔧 **完整的 Forge 支持**: 支持所有 forge 子命令（build, test, script, install 等）
- 🛠️ **灵活的命令执行**: 支持执行任意容器内命令
- 📦 **容器管理**: 自动创建和管理 Foundry 容器
- 🔍 **容器监控**: 列出和管理所有相关容器
- 🔄 **Docker Compose 支持**: 使用 Docker Compose 实现文件自动同步（推荐）

## 前置要求

- Node.js 18+ 
- Docker Desktop 或 Docker Engine
- Docker Compose（推荐，用于文件同步）
- Yarn 包管理器

## 安装

```bash
# 克隆仓库
git clone <repository-url>
cd foundry-mcp

# 安装依赖
yarn install

# 构建项目
yarn build
```

## 使用方法

### 作为 MCP Server 运行

```bash
# 开发模式（使用 tsx）
yarn dev

# 生产模式
yarn start
```

### 配置 MCP 客户端

在 MCP 客户端配置文件中添加：

```json
{
  "mcpServers": {
    "foundry-mcp": {
      "command": "node",
      "args": ["/path/to/foundry-mcp/dist/server.js"]
    }
  }
}
```

## 可用工具

### 1. `forge_execute`

执行任意 forge 命令。

**参数:**

- `command` (必需): forge 子命令，如 'build', 'test', 'script' 等
- `args` (可选): 命令参数数组
- `workingDir` (可选): 工作目录（容器内路径，默认为 /app）
- `containerName` (可选): 容器名称（默认为 foundry-mcp-sandbox）

**示例:**

```json
{
  "command": "build",
  "args": ["--force"],
  "workingDir": "/app"
}
```

### 2. `forge_build`

构建 Foundry 项目。

**参数:**

- `workingDir` (可选): 工作目录
- `extraArgs` (可选): 额外的构建参数

**示例:**

```json
{
  "workingDir": "/app",
  "extraArgs": ["--force"]
}
```

### 3. `forge_test`

运行 Foundry 测试。

**参数:**

- `testPattern` (可选): 测试模式（用于过滤测试）
- `workingDir` (可选): 工作目录
- `extraArgs` (可选): 额外的测试参数

**示例:**

```json
{
  "testPattern": "test/MyTest.t.sol",
  "workingDir": "/app"
}
```

### 4. `forge_script`

运行 Foundry 脚本。

**参数:**

- `scriptPath` (必需): 脚本路径（相对于工作目录）
- `functionName` (可选): 要执行的函数名
- `rpcUrl` (可选): RPC URL（用于部署）
- `workingDir` (可选): 工作目录
- `extraArgs` (可选): 额外的脚本参数

**示例:**

```json
{
  "scriptPath": "script/Deploy.s.sol",
  "functionName": "run",
  "rpcUrl": "https://eth.merkle.io"
}
```

### 5. `docker_execute`

在容器内执行任意命令（非 forge 命令）。

**参数:**

- `command` (必需): 要执行的命令
- `args` (可选): 命令参数数组
- `workingDir` (可选): 工作目录
- `containerName` (可选): 容器名称

**示例:**

```json
{
  "command": "ls",
  "args": ["-la"],
  "workingDir": "/app"
}
```

### 6. `docker_list_containers`

列出所有 Foundry MCP 管理的容器。

**参数:** 无

### 7. `docker_check`

检查 Docker 是否可用。

**参数:** 无

## 工作原理

1. **容器管理**: 
   - 方式一（推荐）：使用 Docker Compose 管理容器，实现文件自动同步
   - 方式二：自动创建和管理 Docker 容器
2. **命令执行**: AI 通过 MCP 工具调用发送命令，服务器将命令转换为容器内的 `forge` 命令
3. **结果返回**: 命令执行完成后，stdout、stderr 和退出码会返回给 AI
4. **持久化**: 容器会保持运行状态，以便后续命令可以复用
5. **文件同步**: 使用 Docker Compose 时，宿主机和容器内的文件实时同步

## Docker Compose 配置（推荐）

使用 Docker Compose 可以自动处理文件挂载，确保 AI 在宿主机修改文件，容器内立即生效。

### 快速开始

```bash
# 启动容器
docker compose up -d

# 测试 Docker Compose 功能
yarn test:compose
```

详细说明请参考 [DOCKER_COMPOSE.md](./DOCKER_COMPOSE.md)

## 项目结构

```
foundry-mcp/
├── src/
│   ├── server.ts           # MCP Server 主文件
│   ├── docker-manager.ts   # Docker 容器管理
│   ├── forge-executor.ts   # Forge 命令执行器
│   └── types.ts            # 类型定义
├── dist/                   # 编译输出
├── package.json
├── tsconfig.json
└── README.md
```

## 开发

```bash
# 开发模式（自动重新编译）
yarn dev

# 构建
yarn build

# 运行编译后的代码
yarn start
```

## 故障排除

### Docker 不可用

确保 Docker Desktop 或 Docker Engine 正在运行：

```bash
docker ps
```

### 容器创建失败

检查 Docker 镜像是否存在：

```bash
docker pull ghcr.io/foundry-rs/foundry:latest
```

### 权限问题

确保 Docker 有足够的权限创建和管理容器。

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！
