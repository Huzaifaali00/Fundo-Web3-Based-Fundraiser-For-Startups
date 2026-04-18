//SPDX-LICENSE-Identifier: MIT
pragma solidity ^0.8.23;
import {Script} from "forge-std/Script.sol";
import {CreatorCoin} from "@zora-protocol/coins/src/CreatorCoin.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

contract DeployCreatorCoin is Script {
function run() external {
    address ProtocolRewardRecipient = vm.envAddress("ProtocolRewardRecipient");
    address ProtocolRewards = vm.envAddress("ProtocolRewards");
    address PoolManager = vm.envAddress("PoolManager");
    address AirLock = vm.envAddress("AirLock");
    vm.startBroadcast();
    new CreatorCoin(ProtocolRewardRecipient, ProtocolRewards, IPoolManager(PoolManager), AirLock);
    vm.stopBroadcast();
}
}