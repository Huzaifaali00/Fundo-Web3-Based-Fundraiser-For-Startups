// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract ZoraHookRegistry is Ownable {
    mapping(address => bool) public isFactory;

    constructor(address initialOwner) Ownable(initialOwner) {}

    // This is the function your ZoraFactoryImpl will call
    function addFactory(address factory) external onlyOwner {
        isFactory[factory] = true;
    }
}