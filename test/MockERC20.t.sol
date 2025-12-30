// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";

contract MockERC20Test is Test {
    MockERC20 public token;
    address public user1 = address(0x1);
    address public user2 = address(0x2);

    function setUp() public {
        token = new MockERC20("Test Token", "TEST", 18);
    }

    function testTokenCreation() public {
        assertEq(token.name(), "Test Token", "Token name should be correct");
        assertEq(token.symbol(), "TEST", "Token symbol should be correct");
        assertEq(token.decimals(), 18, "Token decimals should be 18");
        assertEq(token.totalSupply(), 0, "Initial total supply should be 0");
    }

    function testMint() public {
        uint256 amount = 1000 * 10**18;
        
        token.mint(user1, amount);
        
        assertEq(token.balanceOf(user1), amount, "User1 balance should equal minted amount");
        assertEq(token.totalSupply(), amount, "Total supply should equal minted amount");
    }

    function testMintMultiple() public {
        uint256 amount1 = 1000 * 10**18;
        uint256 amount2 = 2000 * 10**18;
        
        token.mint(user1, amount1);
        token.mint(user2, amount2);
        
        assertEq(token.balanceOf(user1), amount1, "User1 balance should be correct");
        assertEq(token.balanceOf(user2), amount2, "User2 balance should be correct");
        assertEq(token.totalSupply(), amount1 + amount2, "Total supply should be sum of all mints");
    }

    function testTransfer() public {
        uint256 amount = 1000 * 10**18;
        uint256 transferAmount = 500 * 10**18;
        
        token.mint(user1, amount);
        vm.prank(user1);
        token.transfer(user2, transferAmount);
        
        assertEq(token.balanceOf(user1), amount - transferAmount, "User1 balance should decrease");
        assertEq(token.balanceOf(user2), transferAmount, "User2 balance should increase");
        assertEq(token.totalSupply(), amount, "Total supply should remain unchanged");
    }

    function testTransferInsufficientBalance() public {
        uint256 amount = 1000 * 10**18;
        uint256 transferAmount = 2000 * 10**18;
        
        token.mint(user1, amount);
        
        vm.prank(user1);
        vm.expectRevert();
        token.transfer(user2, transferAmount);
    }

    function testApproveAndTransferFrom() public {
        uint256 amount = 1000 * 10**18;
        uint256 approveAmount = 500 * 10**18;
        uint256 transferAmount = 300 * 10**18;
        
        token.mint(user1, amount);
        
        vm.prank(user1);
        token.approve(user2, approveAmount);
        
        assertEq(token.allowance(user1, user2), approveAmount, "Allowance should be set correctly");
        
        vm.prank(user2);
        token.transferFrom(user1, user2, transferAmount);
        
        assertEq(token.balanceOf(user1), amount - transferAmount, "User1 balance should decrease");
        assertEq(token.balanceOf(user2), transferAmount, "User2 balance should increase");
        assertEq(token.allowance(user1, user2), approveAmount - transferAmount, "Allowance should decrease");
    }

    function testTransferFromInsufficientAllowance() public {
        uint256 amount = 1000 * 10**18;
        uint256 approveAmount = 500 * 10**18;
        uint256 transferAmount = 600 * 10**18;
        
        token.mint(user1, amount);
        
        vm.prank(user1);
        token.approve(user2, approveAmount);
        
        vm.prank(user2);
        vm.expectRevert();
        token.transferFrom(user1, user2, transferAmount);
    }

    function testCustomDecimals() public {
        MockERC20 token6 = new MockERC20("Token 6 Decimals", "T6", 6);
        assertEq(token6.decimals(), 6, "Token should have 6 decimals");
        
        MockERC20 token8 = new MockERC20("Token 8 Decimals", "T8", 8);
        assertEq(token8.decimals(), 8, "Token should have 8 decimals");
    }
}

