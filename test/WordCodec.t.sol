// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {WordCodec} from "../contracts/common/codec/WordCodec.sol";

contract WordCodecTest is Test {
    using WordCodec for bytes32;

    function testInsertAndDecodeUint() public {
        bytes32 word = bytes32(0);
        
        // Insert value 42 at offset 0 with 8 bits
        bytes32 result = WordCodec.insertUint(word, 42, 0, 8);
        uint256 decoded = WordCodec.decodeUint(result, 0, 8);
        
        assertEq(decoded, 42, "Decoded value should equal inserted value");
    }

    function testInsertAndDecodeUintAtOffset() public {
        bytes32 word = bytes32(0);
        
        // Insert value 255 at offset 8 with 8 bits
        bytes32 result = WordCodec.insertUint(word, 255, 8, 8);
        uint256 decoded = WordCodec.decodeUint(result, 8, 8);
        
        assertEq(decoded, 255, "Decoded value should equal inserted value");
    }

    function testInsertAndDecodeMultipleUints() public {
        bytes32 word = bytes32(0);
        
        // Insert multiple values at different offsets
        word = WordCodec.insertUint(word, 42, 0, 8);   // 0-7 bits
        word = WordCodec.insertUint(word, 100, 8, 8);  // 8-15 bits
        word = WordCodec.insertUint(word, 200, 16, 8); // 16-23 bits
        
        assertEq(WordCodec.decodeUint(word, 0, 8), 42, "First value should be 42");
        assertEq(WordCodec.decodeUint(word, 8, 8), 100, "Second value should be 100");
        assertEq(WordCodec.decodeUint(word, 16, 8), 200, "Third value should be 200");
    }

    function testInsertAndDecodeBool() public {
        bytes32 word = bytes32(0);
        
        // Insert true at offset 0
        bytes32 result = WordCodec.insertBool(word, true, 0);
        bool decoded = WordCodec.decodeBool(result, 0);
        
        assertTrue(decoded, "Decoded boolean should be true");
        
        // Insert false at offset 1
        result = WordCodec.insertBool(result, false, 1);
        decoded = WordCodec.decodeBool(result, 1);
        
        assertFalse(decoded, "Decoded boolean should be false");
    }

    function testInsertAndDecodeInt() public {
        bytes32 word = bytes32(0);
        
        // Insert positive value
        bytes32 result = WordCodec.insertInt(word, 42, 0, 8);
        int256 decoded = WordCodec.decodeInt(result, 0, 8);
        
        assertEq(decoded, 42, "Decoded positive int should equal inserted value");
        
        // Insert negative value
        result = WordCodec.insertInt(result, -10, 8, 8);
        decoded = WordCodec.decodeInt(result, 8, 8);
        
        assertEq(decoded, -10, "Decoded negative int should equal inserted value");
    }

    function testClearWordAtPosition() public {
        bytes32 word = bytes32(0);
        
        // Insert value
        word = WordCodec.insertUint(word, 255, 8, 8);
        assertEq(WordCodec.decodeUint(word, 8, 8), 255, "Value should be inserted");
        
        // Clear the value
        bytes32 cleared = WordCodec.clearWordAtPosition(word, 8, 8);
        assertEq(WordCodec.decodeUint(cleared, 8, 8), 0, "Value should be cleared");
    }

    function testOverwriteValue() public {
        bytes32 word = bytes32(0);
        
        // Insert initial value
        word = WordCodec.insertUint(word, 100, 0, 8);
        assertEq(WordCodec.decodeUint(word, 0, 8), 100, "Initial value should be 100");
        
        // Overwrite with new value
        word = WordCodec.insertUint(word, 200, 0, 8);
        assertEq(WordCodec.decodeUint(word, 0, 8), 200, "Value should be overwritten to 200");
    }

    function testMaxBitLength() public {
        bytes32 word = bytes32(0);
        
        // Test with maximum bit length (256 bits)
        uint256 maxValue = type(uint256).max;
        bytes32 result = WordCodec.insertUint(word, maxValue, 0, 256);
        uint256 decoded = WordCodec.decodeUint(result, 0, 256);
        
        assertEq(decoded, maxValue, "Should handle maximum uint256 value");
    }
}

