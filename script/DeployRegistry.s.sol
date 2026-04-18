// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ZoraHookRegistry.sol";

contract DeployRegistry is Script {
    function run() external {
        vm.startBroadcast();

        new ZoraHookRegistry(0x1822CBcb0aD767BF6abd81584D06401E2faf9b25);

        vm.stopBroadcast();
    }
}