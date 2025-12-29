# foundry-mcp

一个通过 MCP（Model Context Protocol）在 Docker 沙盒中运行 `forge` 命令的 MCP Server（镜像内预装 Foundry）。

## 适用场景

- 让 AI/Agent 在隔离的 Docker 环境里执行 `forge build/test/clean`，避免污染本机环境
- 文件热同步：本机 Foundry 项目目录挂载到容器内，修改代码即可立刻在容器中生效

更完整的说明见 `docs/USAGE.md`。

## 前置条件

- Docker Desktop (or Docker Engine)
- Node.js 20+
- 一个可运行的 Foundry 项目目录（通常包含 `foundry.toml`）

## 构建沙盒镜像

```bash
docker build -f Dockerfile.foundry -t foundry-sandbox:latest .
```

## 安装与运行 MCP Server

```bash
yarn install
yarn build
node dist/src/index.js
```

### 环境变量

- `FOUNDRY_MCP_IMAGE` (default: `foundry-sandbox:latest`)
- `FOUNDRY_MCP_WORKDIR` (default: `/workspace`)
- `FOUNDRY_MCP_AUTO_BUILD` (default: `true`): 运行前若镜像不存在则自动 `docker build`
- `FOUNDRY_MCP_BUILD_CONTEXT` (default: server `cwd`): `docker build` 的 context 路径
- `FOUNDRY_MCP_DOCKERFILE` (default: `<BUILD_CONTEXT>/Dockerfile.foundry`): Dockerfile 路径
- `FOUNDRY_MCP_CLEANUP_IMAGE` (default: `true`): 每次运行结束后若本次自动构建了镜像则执行 `docker rmi -f <image>`（容器已通过 `--rm` 自动清理）

## MCP 工具（tools）

所有工具都必须传 `projectPath`（Foundry 项目在宿主机上的路径）。该目录会以 volume 方式挂载到容器的 `FOUNDRY_MCP_WORKDIR`，实现文件热同步。

- `forge_build`: run `forge build`
- `forge_test`: run `forge test` (optional `matchPath`)
- `forge_clean`: run `forge clean`

### 参数说明

- `projectPath` (string, required): Foundry 项目目录（绝对路径或相对当前运行目录）。可以传入项目根目录或其子目录，MCP Server 会向上查找并验证 `foundry.toml`，并在执行所有 `forge` 命令时使用该配置；若未找到，则直接报错并终止任务。
- `timeoutMs` (number, optional): 超时（默认 300000ms）
- `forge_test.matchPath` (string, optional): 等同于 `forge test --match-path <matchPath>`
- `forge_test.extraArgs` / `forge_build.extraArgs` (string[], optional): 追加到 forge 命令末尾的额外参数

### 调用示例

在 MCP 客户端里对工具调用时，等价于在沙盒中执行：

- `forge_clean({ projectPath: "/abs/path/to/project" })` → `forge clean`
- `forge_build({ projectPath: "/abs/path/to/project" })` → `forge build`
- `forge_test({ projectPath: "/abs/path/to/project", matchPath: "test/security/Reentrancy.t.sol" })` → `forge test --match-path test/security/Reentrancy.t.sol`

## MCP 客户端配置（stdio）

Example `mcp.json` entry:

```json
{
  "mcpServers": {
    "foundry-sandbox": {
      "command": "node",
      "args": ["<ABS_PATH>/foundry-mcp/dist/src/index.js"],
      "env": {
        "FOUNDRY_MCP_IMAGE": "foundry-sandbox:latest"
      }
    }
  }
}
```

## 常见问题

- Docker 未安装或 `docker` 不在 PATH：安装 Docker Desktop，并确保终端里可运行 `docker version`
- 构建/测试很慢：优先用 `matchPath` 缩小测试范围；必要时提高 `timeoutMs`
- 不想每次都删除镜像：设置 `FOUNDRY_MCP_CLEANUP_IMAGE=false`
