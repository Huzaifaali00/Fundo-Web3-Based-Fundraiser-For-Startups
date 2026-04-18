//SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@zora-protocol/coins/src/customContentCoin.sol";
import {Script} from "forge-std/Script.sol";

contract DeployContentCoin is Script{

    function run() external {
        address ProtocolRewardRecipient = vm.envAddress("ProtocolRewardRecipient");
        address ProtocolRewards = vm.envAddress("ProtocolRewards");
        address PoolManager = vm.envAddress("PoolManager");
        address AirLock = vm.envAddress("AirLock");
        vm.startBroadcast();
        new ContentCoin(ProtocolRewardRecipient, ProtocolRewards, IPoolManager(PoolManager), AirLock);
        vm.stopBroadcast();
}
}