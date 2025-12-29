# Docker Compose 配置说明

## 概述

使用 Docker Compose 管理 Foundry 沙盒环境，实现文件自动同步和容器生命周期管理。

## 配置文件

### `docker-compose.yml` - 生产环境配置

基础配置，用于标准使用场景：

```yaml
services:
  foundry-sandbox:
    image: ghcr.io/foundry-rs/foundry:latest
    container_name: foundry-mcp-sandbox
    working_dir: /app
    volumes:
      - ./test-contract:/app # 挂载测试合约目录
      - foundry-cache:/root/.foundry # 持久化缓存
```

### `docker-compose.dev.yml` - 开发环境配置

增强配置，支持开发场景：

- 文件双向同步（读写）
- 资源限制
- 环境变量配置

## 使用方法

### 1. 启动容器

```bash
# 使用默认配置
docker compose up -d

# 使用开发配置
docker compose -f docker-compose.dev.yml up -d
```

### 2. 停止容器

```bash
# 停止容器（保留数据）
docker compose down

# 停止并删除 volumes
docker compose down -v
```

### 3. 查看状态

```bash
# 查看容器状态
docker compose ps

# 查看日志
docker compose logs -f foundry-sandbox
```

### 4. 执行命令

```bash
# 在容器内执行 forge 命令
docker compose exec foundry-sandbox forge build

# 执行测试
docker compose exec foundry-sandbox forge test

# 执行任意命令
docker compose exec foundry-sandbox sh -c "ls -la"
```

## 文件同步

### 工作原理

- **宿主机 → 容器**: 实时同步

  - 在宿主机修改 `./test-contract/` 中的文件
  - 容器内 `/app/` 目录立即看到更改

- **容器 → 宿主机**: 实时同步
  - 在容器内修改 `/app/` 中的文件
  - 宿主机 `./test-contract/` 目录立即看到更改

### 示例

1. **在宿主机创建文件**:

   ```bash
   echo "contract Test {}" > test-contract/Test.sol
   ```

2. **在容器内查看**:

   ```bash
   docker compose exec foundry-sandbox ls -la /app/
   # 可以看到 Test.sol
   ```

3. **在容器内编译**:

   ```bash
   docker compose exec foundry-sandbox forge build
   ```

4. **在宿主机查看编译结果**:
   ```bash
   ls test-contract/out/
   # 可以看到编译后的文件
   ```

## 与 MCP Server 集成

### 使用 Docker Compose 执行器

```typescript
import { ForgeExecutorCompose } from "./forge-executor-compose.js";

const executor = new ForgeExecutorCompose("docker-compose.yml");

// 执行 forge 命令
const result = await executor.execute({
  command: "build",
  args: [],
});
```

### 优势

1. **自动文件同步**: 无需手动复制文件
2. **持久化缓存**: Foundry 缓存保存在 volume 中
3. **资源管理**: 可以限制 CPU 和内存使用
4. **网络隔离**: 容器在独立网络中运行
5. **易于管理**: 使用标准 Docker Compose 命令

## 测试

运行 Docker Compose 测试：

```bash
yarn test:compose
```

测试包括：

- Docker Compose 可用性检查
- 容器启动和状态检查
- Forge 命令执行
- 文件同步验证

## 故障排除

### 容器无法启动

```bash
# 检查 Docker Compose 版本
docker compose version

# 查看详细错误
docker compose up
```

### 文件不同步

1. 检查 volume 挂载：

   ```bash
   docker compose config
   ```

2. 检查文件权限：

   ```bash
   ls -la test-contract/
   ```

3. 重启容器：
   ```bash
   docker compose restart
   ```

### 端口冲突

如果容器需要暴露端口，在 `docker-compose.yml` 中添加：

```yaml
ports:
  - "8545:8545" # 示例：RPC 端口
```

## 最佳实践

1. **使用开发配置**: 开发时使用 `docker-compose.dev.yml`
2. **定期清理**: 定期运行 `docker compose down -v` 清理 volumes
3. **监控资源**: 使用 `docker stats` 监控容器资源使用
4. **备份数据**: 重要数据应备份到宿主机

## 环境变量

可以通过环境变量配置：

```bash
# 设置 Foundry profile
export FOUNDRY_PROFILE=ci

# 启动容器
docker compose up -d
```

或在 `docker-compose.yml` 中设置：

```yaml
environment:
  - FOUNDRY_PROFILE=ci
  - FOUNDRY_OPTIMIZER_RUNS=10000
```

## 相关文件

- `docker-compose.yml` - 生产配置
- `docker-compose.dev.yml` - 开发配置
- `src/docker-compose-manager.ts` - Docker Compose 管理模块
- `src/forge-executor-compose.ts` - Forge 执行器（Compose 版本）
