// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {BitMath} from "../contracts/libraries/BitMath.sol";

contract BitMathTest is Test {
    function testMostSignificantBit() public {
        // Test with power of 2
        assertEq(BitMath.mostSignificantBit(1), 0, "MSB of 1 should be 0");
        assertEq(BitMath.mostSignificantBit(2), 1, "MSB of 2 should be 1");
        assertEq(BitMath.mostSignificantBit(4), 2, "MSB of 4 should be 2");
        assertEq(BitMath.mostSignificantBit(8), 3, "MSB of 8 should be 3");
        assertEq(BitMath.mostSignificantBit(16), 4, "MSB of 16 should be 4");
        assertEq(BitMath.mostSignificantBit(256), 8, "MSB of 256 should be 8");
        
        // Test with non-power of 2
        assertEq(BitMath.mostSignificantBit(3), 1, "MSB of 3 should be 1");
        assertEq(BitMath.mostSignificantBit(5), 2, "MSB of 5 should be 2");
        assertEq(BitMath.mostSignificantBit(7), 2, "MSB of 7 should be 2");
        assertEq(BitMath.mostSignificantBit(15), 3, "MSB of 15 should be 3");
        
        // Test with large numbers
        assertEq(BitMath.mostSignificantBit(type(uint256).max), 255, "MSB of max uint256 should be 255");
    }

    function testLeastSignificantBit() public {
        // Test with power of 2
        assertEq(BitMath.leastSignificantBit(1), 0, "LSB of 1 should be 0");
        assertEq(BitMath.leastSignificantBit(2), 1, "LSB of 2 should be 1");
        assertEq(BitMath.leastSignificantBit(4), 2, "LSB of 4 should be 2");
        assertEq(BitMath.leastSignificantBit(8), 3, "LSB of 8 should be 3");
        assertEq(BitMath.leastSignificantBit(16), 4, "LSB of 16 should be 4");
        assertEq(BitMath.leastSignificantBit(256), 8, "LSB of 256 should be 8");
        
        // Test with odd numbers (LSB is always 0 for odd numbers)
        assertEq(BitMath.leastSignificantBit(3), 0, "LSB of 3 should be 0");
        assertEq(BitMath.leastSignificantBit(5), 0, "LSB of 5 should be 0");
        assertEq(BitMath.leastSignificantBit(7), 0, "LSB of 7 should be 0");
        
        // Test with numbers that have LSB > 0
        assertEq(BitMath.leastSignificantBit(6), 1, "LSB of 6 should be 1"); // 6 = 2 * 3
        assertEq(BitMath.leastSignificantBit(12), 2, "LSB of 12 should be 2"); // 12 = 4 * 3
        
        // Test with large numbers
        uint256 largeNumber = 1 << 128;
        assertEq(BitMath.leastSignificantBit(largeNumber), 128, "LSB of 2^128 should be 128");
    }

    function testMostSignificantBitEdgeCases() public {
        // Test with minimum value (1)
        assertEq(BitMath.mostSignificantBit(1), 0, "MSB of 1 should be 0");
        
        // Test with maximum value
        assertEq(BitMath.mostSignificantBit(type(uint256).max), 255, "MSB of max should be 255");
        
        // Test with values just below powers of 2
        assertEq(BitMath.mostSignificantBit(255), 7, "MSB of 255 should be 7");
        assertEq(BitMath.mostSignificantBit(511), 8, "MSB of 511 should be 8");
    }

    function testLeastSignificantBitEdgeCases() public {
        // Test with minimum value (1)
        assertEq(BitMath.leastSignificantBit(1), 0, "LSB of 1 should be 0");
        
        // Test with maximum value (all bits set, LSB is 0)
        assertEq(BitMath.leastSignificantBit(type(uint256).max), 0, "LSB of max should be 0");
        
        // Test with values that are powers of 2
        for (uint8 i = 0; i < 8; i++) {
            uint256 value = 1 << i;
            assertEq(BitMath.leastSignificantBit(value), i, "LSB should equal the power");
        }
    }

    function testMostSignificantBitFailsWithZero() public {
        vm.expectRevert();
        BitMath.mostSignificantBit(0);
    }

    function testLeastSignificantBitFailsWithZero() public {
        vm.expectRevert();
        BitMath.leastSignificantBit(0);
    }
}

