// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Math} from "../contracts/libraries/Math.sol";

contract MathTest is Test {
    using Math for uint256;

    function testMin() public {
        assertEq(Math.min(10, 20), 10, "min(10, 20) should be 10");
        assertEq(Math.min(20, 10), 10, "min(20, 10) should be 10");
        assertEq(Math.min(5, 5), 5, "min(5, 5) should be 5");
    }

    function testMax() public {
        assertEq(Math.max(10, 20), 20, "max(10, 20) should be 20");
        assertEq(Math.max(20, 10), 20, "max(20, 10) should be 20");
        assertEq(Math.max(5, 5), 5, "max(5, 5) should be 5");
    }

    function testMulDivDown() public {
        assertEq(Math.mulDivDown(10, 20, 5), 40, "mulDivDown(10, 20, 5) should be 40");
        assertEq(Math.mulDivDown(100, 200, 50), 400, "mulDivDown(100, 200, 50) should be 400");
        assertEq(Math.mulDivDown(3, 7, 2), 10, "mulDivDown(3, 7, 2) should be 10 (floor of 10.5)");
    }

    function testMulDivUp() public {
        assertEq(Math.mulDivUp(10, 20, 5), 40, "mulDivUp(10, 20, 5) should be 40");
        assertEq(Math.mulDivUp(100, 200, 50), 400, "mulDivUp(100, 200, 50) should be 400");
        assertEq(Math.mulDivUp(3, 7, 2), 11, "mulDivUp(3, 7, 2) should be 11 (ceil of 10.5)");
    }

    function testMulDivWithRounding() public {
        // Test with Rounding.Down
        assertEq(
            Math.mulDiv(3, 7, 2, Math.Rounding.Down),
            10,
            "mulDiv with Rounding.Down should floor the result"
        );
        
        // Test with Rounding.Up
        assertEq(
            Math.mulDiv(3, 7, 2, Math.Rounding.Up),
            11,
            "mulDiv with Rounding.Up should ceil the result"
        );
    }

    function testMulDivEdgeCases() public {
        // Test with zero
        assertEq(Math.mulDivDown(0, 100, 10), 0, "mulDivDown with zero should return 0");
        assertEq(Math.mulDivUp(0, 100, 10), 0, "mulDivUp with zero should return 0");
        
        // Test with large numbers
        assertEq(
            Math.mulDivDown(type(uint256).max / 2, 2, 1),
            type(uint256).max - 1,
            "Should handle large numbers"
        );
    }
}

