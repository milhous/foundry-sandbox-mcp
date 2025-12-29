// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {Counter} from "./Counter.sol";

/**
 * @title CounterTest
 * @dev Counter 合约的测试文件
 */
contract CounterTest is Test {
    Counter public counter;
    address public owner = address(0x1);
    address public user = address(0x2);

    function setUp() public {
        vm.prank(owner);
        counter = new Counter();
    }

    function test_InitialCount() public {
        assertEq(counter.count(), 0);
        assertEq(counter.owner(), owner);
    }

    function test_Increment() public {
        counter.increment(5);
        assertEq(counter.count(), 5);
        counter.increment(3);
        assertEq(counter.count(), 8);
    }

    function test_Decrement() public {
        counter.increment(10);
        counter.decrement(3);
        assertEq(counter.count(), 7);
    }

    function test_DecrementReverts() public {
        counter.increment(5);
        vm.expectRevert("Counter: count cannot be negative");
        counter.decrement(10);
    }

    function test_Reset() public {
        counter.increment(10);
        vm.prank(owner);
        counter.reset();
        assertEq(counter.count(), 0);
    }

    function test_ResetReverts() public {
        counter.increment(10);
        vm.prank(user);
        vm.expectRevert("Counter: caller is not the owner");
        counter.reset();
    }

    function test_GetCount() public view {
        assertEq(counter.getCount(), counter.count());
    }

    function test_Events() public {
        vm.expectEmit(true, false, false, false);
        emit Counter.CountIncreased(5);
        counter.increment(5);

        vm.expectEmit(true, false, false, false);
        emit Counter.CountDecreased(2);
        counter.decrement(2);

        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit Counter.CountReset();
        counter.reset();
    }
}

