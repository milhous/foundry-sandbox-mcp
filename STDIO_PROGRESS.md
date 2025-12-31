# MCP stdio 传输方式下的实时进度通知

## 概述

本文档说明在使用 stdio 传输方式时，MCP 服务器如何向 Agent 实时传递运行状态和进度信息。

## stdio 传输方式的工作原理

### 1. 传输通道

在 stdio 模式下，MCP 使用以下通道：

- **stdin**: 用于接收来自客户端的 JSON-RPC 2.0 请求
- **stdout**: 用于发送 JSON-RPC 2.0 响应（结构化数据）
- **stderr**: 用于输出日志和进度信息（非结构化数据）

### 2. 实时进度通知的实现

#### 当前实现方式

我们通过 `stderr` 输出实时进度信息：

```typescript
// 进度日志输出
console.error(`[${timestamp}] [Progress] ${message}`);

// 或者直接写入 stderr
process.stderr.write(text, () => {
  // 写入完成后立即刷新
  process.stderr.write('', () => {});
});
```

#### 关键优化点

1. **立即刷新机制**
   - 使用 `process.stderr.write()` 的回调函数确保写入完成
   - 在写入完成后立即刷新，避免缓冲延迟

2. **实时流处理**
   - Docker 命令的输出通过流实时传递
   - 在数据到达时立即写入 stderr，不等待命令完成

3. **格式化输出**
   - 使用清晰的前缀标识进度日志：`[Progress]`
   - 添加时间戳便于追踪
   - 使用 emoji 和分隔线增强可读性

## 实时输出的内容

### 1. MCP 服务器进度日志

- 容器创建进度
- 依赖安装进度
- 测试执行进度
- 容器清理进度

### 2. Docker 命令输出

- `forge install` 的安装输出
- `forge test` 的编译和测试输出
- 所有命令的 stdout 和 stderr

## 客户端支持情况

### 理论支持

在 stdio 模式下，`stderr` 的输出理论上可以被 MCP 客户端实时接收，因为：

1. stderr 是独立的输出流
2. 不干扰 stdout 的 JSON-RPC 通信
3. 可以实时读取和显示

### 实际限制

**取决于 MCP 客户端的实现**：

1. **客户端可能缓冲 stderr**
   - 某些客户端可能不会实时显示 stderr 输出
   - 可能等到工具调用完成后才显示所有日志

2. **客户端可能忽略 stderr**
   - 某些客户端可能只关注 stdout 的 JSON-RPC 响应
   - 可能不会显示 stderr 的内容

3. **客户端可能合并输出**
   - 可能将 stderr 和 stdout 合并显示
   - 可能影响输出的实时性

## 最佳实践

### 1. 确保输出立即刷新

```typescript
// ✅ 推荐：使用回调确保刷新
process.stderr.write(text, () => {
  process.stderr.write('', () => {});
});

// ❌ 不推荐：可能被缓冲
console.error(text);
```

### 2. 使用清晰的格式

```typescript
// ✅ 推荐：清晰的格式便于识别
const logMessage = `[${timestamp}] [Progress] ${message}\n`;
process.stderr.write(logMessage);

// ❌ 不推荐：格式不清晰
process.stderr.write(message);
```

### 3. 在最终响应中包含日志

即使客户端可能不实时显示 stderr，也应该在最终响应中包含完整的日志：

```typescript
return {
  content: [
    {
      type: "text",
      text: `${status}${logs}\n\n${formattedOutput}`,
    },
  ],
};
```

## 验证实时输出

### 测试方法

1. **直接运行 MCP 服务器**
   ```bash
   node dist/index.js
   ```

2. **观察 stderr 输出**
   - 应该能看到实时的进度日志
   - 应该能看到 Docker 命令的实时输出

3. **通过 MCP 客户端测试**
   - 使用支持实时日志的客户端
   - 观察是否能实时看到进度信息

## 替代方案

如果 stdio 方式无法满足实时性要求，可以考虑：

### 1. SSE (Server-Sent Events) 传输

MCP SDK 支持 SSE 传输方式，可以实现真正的实时进度通知：

```typescript
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
```

### 2. WebSocket 传输

对于需要双向实时通信的场景，可以使用 WebSocket：

```typescript
import { WebSocketServerTransport } from "@modelcontextprotocol/sdk/server/websocket.js";
```

## 总结

### stdio 方式的实时性

✅ **支持实时输出**：
- stderr 可以实时传递日志
- 通过立即刷新机制确保实时性
- Docker 命令输出可以实时显示

⚠️ **受客户端限制**：
- 取决于 MCP 客户端的实现
- 某些客户端可能缓冲或忽略 stderr
- 最终响应中应包含完整日志作为备份

### 当前实现

我们的实现已经：
- ✅ 通过 stderr 实时输出进度日志
- ✅ 实时输出 Docker 命令的执行结果
- ✅ 在最终响应中包含完整日志
- ✅ 使用立即刷新机制确保实时性

这确保了在支持实时日志的客户端中，Agent 可以实时看到执行进度和 Docker 命令的输出。

