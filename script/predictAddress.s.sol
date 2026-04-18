// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";

contract PredictAddress is Script {
    function run() external view {
        address deployer = 0xf9cBC41849dB34cA64D2e3a9120020Bf3Ef76F5C; // Replace this
        uint256 nonce = 45; // Replace with your current nonce

        address predicted = vm.computeCreateAddress(deployer, nonce);
        console.log("Predicted Factory Address:", predicted);
    }
}