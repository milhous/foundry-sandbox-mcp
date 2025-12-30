# Foundry 测试合约

本目录包含项目的 Foundry 测试合约。

## 测试文件

### 1. WordCodec.t.sol

测试 `WordCodec` 库的功能，包括：

- `insertUint` 和 `decodeUint` - 无符号整数编码/解码
- `insertInt` 和 `decodeInt` - 有符号整数编码/解码
- `insertBool` 和 `decodeBool` - 布尔值编码/解码
- `clearWordAtPosition` - 清除指定位置的值
- 多值插入和覆盖测试
- 边界值测试

### 2. Math.t.sol

测试 `Math` 库的功能，包括：

- `min` 和 `max` - 最小值和最大值
- `mulDivDown` - 向下取整的乘除运算
- `mulDivUp` - 向上取整的乘除运算
- `mulDiv` - 带舍入模式的乘除运算
- 边界值测试

### 3. BitMath.t.sol

测试 `BitMath` 库的功能，包括：

- `mostSignificantBit` - 最高有效位索引
- `leastSignificantBit` - 最低有效位索引
- 边界值测试（包括零值错误处理）
- 各种数值场景测试

### 4. MockERC20.t.sol

测试 `MockERC20` 合约的功能，包括：

- 代币创建和初始化
- `mint` - 铸造代币
- `transfer` - 转账功能
- `approve` 和 `transferFrom` - 授权和代理转账
- 自定义小数位数
- 错误情况处理（余额不足、授权不足等）

## 使用 foundry-sandbox 运行测试

### 前置要求

1. **Docker 必须正在运行**
   ```bash
   docker ps
   ```

2. **确保 Docker 镜像已构建**
   ```bash
   docker build -t foundry-sandbox:latest -f Dockerfile.foundry .
   ```

### 运行测试

使用 MCP 工具 `forge_test` 运行测试：

#### 运行所有测试

```json
{
  "name": "forge_test",
  "arguments": {
    "foundryTomlPath": "/absolute/path/to/foundry-mcp/foundry.toml"
  }
}
```

#### 运行特定测试文件

```json
{
  "name": "forge_test",
  "arguments": {
    "foundryTomlPath": "/absolute/path/to/foundry-mcp/foundry.toml",
    "testPath": "test/WordCodec.t.sol"
  }
}
```

#### 运行特定测试函数

```json
{
  "name": "forge_test",
  "arguments": {
    "foundryTomlPath": "/absolute/path/to/foundry-mcp/foundry.toml",
    "matchPath": "test/WordCodec.t.sol:WordCodecTest#testInsertAndDecodeUint"
  }
}
```

### 本地运行测试（不使用 MCP）

如果不想使用 MCP，也可以直接在本地运行：

```bash
# 运行所有测试
forge test

# 运行特定测试文件
forge test --match-path test/WordCodec.t.sol

# 运行特定测试函数
forge test --match-path "test/WordCodec.t.sol:WordCodecTest#testInsertAndDecodeUint"

# 详细输出
forge test -vvv
```

## 测试覆盖

- ✅ WordCodec 库的所有主要功能
- ✅ Math 库的所有主要功能
- ✅ BitMath 库的所有主要功能
- ✅ MockERC20 合约的所有主要功能
- ✅ 边界值和错误情况
- ✅ 多值操作和覆盖场景
- ✅ ERC20 标准功能测试

## 注意事项

- 测试使用 Foundry 的 `Test` 合约框架
- 所有测试都是纯函数测试，不涉及外部调用
- 测试在 Docker 容器中运行，确保环境一致性

