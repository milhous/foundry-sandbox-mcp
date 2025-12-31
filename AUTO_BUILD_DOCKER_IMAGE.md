# Docker 镜像自动构建功能

## 概述

MCP 工具现在支持自动检测并构建 Docker 镜像。当其他项目调用 MCP 工具时，如果 Docker 镜像不存在，工具会自动从 MCP 服务器目录读取 `Dockerfile.foundry` 和 `docker-compose.yml` 配置，使用 `docker-compose build` 命令构建镜像。

## 功能特性

- ✅ **自动检测**：自动检测 Docker 镜像是否存在
- ✅ **自动构建**：如果镜像不存在，自动从 MCP 项目路径读取 `Dockerfile.foundry` 并构建
- ✅ **智能查找**：自动从多个位置查找 MCP 项目路径
- ✅ **实时进度**：显示构建进度和日志
- ✅ **错误处理**：提供清晰的错误信息

## 工作原理

### 1. 镜像检测

当调用 `forge_test` 工具时，MCP 会：
1. 检查 Docker 镜像 `foundry-sandbox:latest` 是否存在
2. 如果存在，直接使用
3. 如果不存在，进入自动构建流程

### 2. 自动构建流程

如果镜像不存在，MCP 会：

1. **查找 MCP 服务器路径**（按优先级）：
   - 构造函数传入的 `mcpProjectPath` 参数
   - 环境变量 `FOUNDRY_MCP_PROJECT_PATH`
   - 当前工作目录（`process.cwd()`）
   - 编译后的文件位置（`dist/../..`）

2. **验证配置文件**：
   - 检查 `Dockerfile.foundry` 是否存在
   - 检查 `docker-compose.yml` 是否存在
   - 如果任一文件不存在，提供清晰的错误信息

3. **构建镜像**：
   - 使用 `docker-compose build foundry-sandbox` 命令构建镜像
   - 实时显示构建进度和日志
   - 从 MCP 服务器目录读取配置

4. **完成构建**：
   - 镜像构建完成后，继续执行测试流程

## 配置方式

### 方式 1: 环境变量（推荐）

在 MCP 客户端配置中设置环境变量：

```json
{
  "mcpServers": {
    "foundry-sandbox": {
      "command": "node",
      "args": ["/absolute/path/to/foundry-mcp/dist/index.js"],
      "env": {
        "FOUNDRY_MCP_PROJECT_PATH": "/absolute/path/to/foundry-mcp"
      }
    }
  }
}
```

**重要**：MCP 服务器目录必须同时包含 `Dockerfile.foundry` 和 `docker-compose.yml` 文件。

### 方式 2: 自动查找

如果不设置环境变量，MCP 会自动从以下位置查找（需要同时存在两个文件）：

1. 当前工作目录（如果 MCP 服务器在项目根目录运行）
2. 编译后的文件位置（`dist/../..`）

### 方式 3: 代码传递（高级）

在代码中传递 MCP 项目路径：

```typescript
const dockerManager = new DockerManager(projectPath, mcpProjectPath);
```

## 使用示例

### 示例 1: 首次使用（自动构建）

```
用户: 在沙盒中运行我的 Foundry 项目测试
```

MCP 工具会自动：
1. 检测到镜像不存在
2. 查找 MCP 服务器路径
3. 读取 `Dockerfile.foundry` 和 `docker-compose.yml`
4. 使用 `docker-compose build` 构建 Docker 镜像（显示构建进度）
5. 创建容器并运行测试

### 示例 2: 后续使用（直接使用）

```
用户: 在沙盒中运行我的 Foundry 项目测试
```

MCP 工具会：
1. 检测到镜像已存在
2. 直接创建容器并运行测试（跳过构建步骤）

## 构建日志示例

自动构建时会显示以下日志：

```
═══════════════════════════════════════════════════════
🔨 Docker 镜像不存在，开始自动构建...
═══════════════════════════════════════════════════════
📁 构建上下文: /path/to/foundry-mcp
📄 Dockerfile: /path/to/foundry-mcp/Dockerfile.foundry
📦 [构建进度信息...]
✅ Docker 镜像构建完成
═══════════════════════════════════════════════════════
```

## 故障排除

### 问题 1: 找不到 Dockerfile.foundry 或 docker-compose.yml

**错误信息**：
```
Docker image 'foundry-sandbox:latest' not found and cannot auto-build.
Please set FOUNDRY_MCP_PROJECT_PATH environment variable
```

**解决方法**：
1. 设置环境变量 `FOUNDRY_MCP_PROJECT_PATH` 指向 MCP 服务器根目录（必须包含 `Dockerfile.foundry` 和 `docker-compose.yml`）
2. 或手动构建镜像：
   ```bash
   # 使用 docker-compose（推荐）
   docker-compose build foundry-sandbox
   
   # 或使用 docker build
   docker build -t foundry-sandbox:latest -f Dockerfile.foundry .
   ```

### 问题 2: 构建失败

**可能原因**：
- Docker 未运行
- docker-compose 未安装
- 网络问题（下载基础镜像失败）
- Dockerfile 或 docker-compose.yml 语法错误

**解决方法**：
1. 检查 Docker 是否运行：`docker ps`
2. 检查 docker-compose 是否安装：`docker-compose --version`
3. 检查网络连接
4. 手动构建镜像查看详细错误：
   ```bash
   docker-compose build foundry-sandbox
   ```

### 问题 3: 构建时间过长

**说明**：
- 首次构建需要下载基础镜像，可能需要几分钟
- 后续构建会使用缓存，速度更快

**优化建议**：
- 预先构建镜像：`docker build -t foundry-sandbox:latest -f Dockerfile.foundry .`
- 使用本地镜像缓存

## 性能考虑

### 首次构建
- 需要下载基础镜像（~500MB）
- 安装 Node.js 和 npm
- 总时间：约 2-5 分钟（取决于网络速度）

### 后续使用
- 镜像已存在，直接使用
- 创建容器时间：约 1-2 秒

### 优化建议
1. **预先构建镜像**：在首次使用前手动构建镜像
2. **使用镜像缓存**：Docker 会自动缓存构建层
3. **设置环境变量**：避免每次查找 MCP 项目路径

## 最佳实践

1. **设置环境变量**：
   ```bash
   export FOUNDRY_MCP_PROJECT_PATH=/path/to/foundry-mcp
   ```

2. **预先构建镜像**（可选）：
   ```bash
   docker build -t foundry-sandbox:latest -f Dockerfile.foundry .
   ```

3. **验证配置**：
   - 确保 `Dockerfile.foundry` 存在于 MCP 项目根目录
   - 确保 Docker 正在运行

## 技术细节

### 构建方式
- 使用 `docker-compose build` 命令构建镜像
- 从 MCP 服务器目录读取 `Dockerfile.foundry` 和 `docker-compose.yml`
- 使用 `spawn` 实现实时输出构建日志

### 构建输出
- 实时显示 docker-compose 构建输出
- 过滤详细的下载和提取信息
- 显示构建进度和状态信息

### 错误处理
- 完整的错误捕获和报告
- 提供清晰的错误信息和解决建议
- 检查 docker-compose 命令执行结果

## 总结

自动构建功能让 MCP 工具更加易用：
- ✅ 无需手动构建镜像
- ✅ 自动检测和构建（使用 docker-compose）
- ✅ 实时进度显示
- ✅ 完善的错误处理
- ✅ 使用标准的 docker-compose 配置

只需设置环境变量（可选），MCP 工具就能自动处理 Docker 镜像的构建和管理。

**要求**：
- MCP 服务器目录必须包含 `Dockerfile.foundry` 和 `docker-compose.yml`
- 系统必须安装 `docker-compose` 命令

