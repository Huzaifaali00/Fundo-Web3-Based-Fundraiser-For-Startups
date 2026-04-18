// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import {ZoraFactoryImpl} from "@zora-protocol/coins/src/ZoraFactoryImpl.sol";

contract DeployImplementation is Script {
    // Current addresses from your previous traces
    address coinv4impl = vm.envAddress("coinv4impl");
    address creatorCoinImpl = vm.envAddress("creatorCoinImpl");
    address zoraHookRegistry = vm.envAddress("newZoraHookRegistery");
    address newHook = vm.envAddress("newcoinV4Hook"); 

    function run() external {
        
        vm.startBroadcast();
        ZoraFactoryImpl implementation = new ZoraFactoryImpl(
            coinv4impl,
            creatorCoinImpl,
            newHook,
            zoraHookRegistry
        );

        vm.stopBroadcast();

        console.log("REAL IMPLEMENTATION DEPLOYED AT:", address(implementation));
    }
}