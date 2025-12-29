// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Counter
 * @dev 一个简单的计数器合约，用于测试 MCP 功能
 */
contract Counter {
    uint256 public count;
    address public owner;

    event CountIncreased(uint256 newCount);
    event CountDecreased(uint256 newCount);
    event CountReset();

    modifier onlyOwner() {
        require(msg.sender == owner, "Counter: caller is not the owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        count = 0;
    }

    /**
     * @dev 增加计数器
     * @param amount 要增加的数量
     */
    function increment(uint256 amount) public {
        count += amount;
        emit CountIncreased(count);
    }

    /**
     * @dev 减少计数器
     * @param amount 要减少的数量
     */
    function decrement(uint256 amount) public {
        require(count >= amount, "Counter: count cannot be negative");
        count -= amount;
        emit CountDecreased(count);
    }

    /**
     * @dev 重置计数器（仅所有者）
     */
    function reset() public onlyOwner {
        count = 0;
        emit CountReset();
    }

    /**
     * @dev 获取当前计数
     * @return 当前计数值
     */
    function getCount() public view returns (uint256) {
        return count;
    }
}

