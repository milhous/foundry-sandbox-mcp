# 使用文档（foundry-mcp）

## 1. 快速开始

1) 构建沙盒镜像：

```bash
docker build -f Dockerfile.foundry -t foundry-sandbox:latest .
```

2) 安装依赖并构建：

```bash
yarn install
yarn build
```

3) 以 stdio 方式运行 MCP Server（供 MCP 客户端启动）：

```bash
node dist/src/index.js
```

## 2. MCP 客户端接入

把下面配置加入你的 MCP 客户端配置文件（示例 `mcp.json`）：

```json
{
  "mcpServers": {
    "foundry-sandbox": {
      "command": "node",
      "args": ["<ABS_PATH>/foundry-mcp/dist/src/index.js"],
      "env": {
        "FOUNDRY_MCP_IMAGE": "foundry-sandbox:latest",
        "FOUNDRY_MCP_WORKDIR": "/workspace"
      }
    }
  }
}
```

## 2.1 镜像自动准备与清理（默认开启）

默认行为：

- 运行前：若 `FOUNDRY_MCP_IMAGE` 不存在，则自动执行 `docker build`
- 运行后：容器通过 `docker run --rm` 自动清理；镜像通过 `docker rmi -f` 自动删除

可用环境变量：

- `FOUNDRY_MCP_AUTO_BUILD`：是否自动构建镜像（默认 `true`）
- `FOUNDRY_MCP_BUILD_CONTEXT`：构建上下文（默认 server 的 `cwd`）
- `FOUNDRY_MCP_DOCKERFILE`：Dockerfile 路径（默认 `<BUILD_CONTEXT>/Dockerfile.foundry`）
- `FOUNDRY_MCP_CLEANUP_IMAGE`：是否在每次运行后删除由本次自动构建的镜像（默认 `true`）

## 3. 工具列表与参数

### 3.1 `forge_clean`

清理构建产物，确保每次测试从干净环境开始。

参数：

- `projectPath` (string, required)：可为项目根目录或位于根目录下的任意子目录。Server 会向上查找并验证 `foundry.toml`，确保 `forge` 使用该配置；如果无法找到，则立刻中止并返回错误。
- `timeoutMs` (number, optional)

### 3.2 `forge_build`

在沙盒中执行 `forge build`。

- `projectPath` (string, required)：可为项目根目录或其子目录，但必须能找到 `foundry.toml`。如果缺失则会报错。
- `extraArgs` (string[], optional)
- `timeoutMs` (number, optional)

### 3.3 `forge_test`

在沙盒中执行 `forge test`。

- `projectPath` (string, required)：同样要求路径中或父级目录存在 `foundry.toml`，否则会被拒绝。
- `matchPath` (string, optional)：等同 `forge test --match-path <matchPath>`
- `extraArgs` (string[], optional)
- `timeoutMs` (number, optional)

## 4. 文件热同步（核心机制）

MCP Server 会用 Docker volume 把宿主机 `projectPath` 挂载到容器内的工作目录（默认 `/workspace`），并在该目录中运行 `forge`：

- 你在编辑器里改动 Foundry 项目文件
- 容器内看到的是同一份文件（实时生效）

## 5. 建议的工作流

为了得到更稳定的沙盒验证结果，推荐：

1) `forge_clean`
2) `forge_build`
3) `forge_test`（尽量使用 `matchPath` 定位到目标测试文件）

## 6. 故障排查

- 报错 “Docker CLI not found”：确认本机已安装 Docker 并且 `docker` 在 PATH 中
- 报错 “projectPath is not a directory”：检查传入路径是否为目录、是否有权限访问
- 容器中构建产物权限问题：本实现会在非 Windows 平台尝试使用宿主机 uid/gid 运行容器，仍有问题可检查 Docker Desktop 文件共享设置
