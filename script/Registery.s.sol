// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import {ZoraFactoryImpl} from "@zora-protocol/coins/src/ZoraFactoryImpl.sol";

interface IProxy {
    function upgradeToAndCall(address newImplementation, bytes memory data) external;
}

contract FinalizeRegistry is Script {
    function run() external {
        uint256 sk = vm.envUint("NEW_PRIVATE_KEY");
        address proxyAddr = 0x2284bFb0310F20B7d5a0F82b988Fe0c9322c95d4;
        address REAL_REGISTRY = 0x3a34F62bcBa4B091ADb28b369e559137CDF4F4c4;
        address REAL_HOOK = 0x31cb62E9E10b6D0022f792C70BF9838e0fCdD0C0;

        vm.startBroadcast(sk);

        // 1. Deploy the "Clean" Implementation with the REAL addresses
        ZoraFactoryImpl finalImpl = new ZoraFactoryImpl(
            vm.envAddress("coinv4impl"),
            vm.envAddress("creatorCoinImpl"),
            REAL_HOOK, 
            REAL_REGISTRY
        );

        // 2. Upgrade the Proxy to use this new Implementation
        // We don't need to 'initialize' again, so data is empty
        ZoraFactoryImpl(proxyAddr).upgradeTo(address(finalImpl));

        vm.stopBroadcast();

        console.log("REGISTRY FINALIZED");
        console.log("New Implementation:", address(finalImpl));
    }
}