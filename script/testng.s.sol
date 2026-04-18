// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IZoraFactory} from "../lib/zora-protocol/packages/coins/src/interfaces/IZoraFactory.sol";
import {CoinConfigurationVersions} from "../lib/zora-protocol/packages/coins/src/libs/CoinConfigurationVersions.sol";

// --- UNISWAP V4 CORE IMPORTS ---
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

// --- REQUIRED FOR getSlot0 ---
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

contract TestContentCoin is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager; 

    address payable factoryProxy = payable(0x31Dc9ad82F56b24f42d8C2EEBf3c798660fc1361);
    address WETH = 0x4200000000000000000000000000000000000006;
    address poolManagerAddr = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address hookAddr = 0x30Bc80e895bb92F331f20e084dF487261d4Dd0c0;

    function run() external {
        vm.startBroadcast();

        // 1. Setup Config
        bytes memory poolConfig = CoinConfigurationVersions.defaultConfig(WETH);
        address[] memory owners = new address[](1);
        owners[0] = msg.sender;
        bytes32 freshSalt = keccak256(abi.encodePacked("FYP_FINAL_VERIFY_", block.timestamp));

        // 2. Deploy via Factory
        // The Factory calls _createCoinWithPoolConfig which calls coin.initialize()
        (address coin, ) = IZoraFactory(factoryProxy).deploy({
            payoutRecipient: msg.sender,
            owners: owners,
            uri: "ipfs://test-metadata",
            name: "FYP Token V4",
            symbol: "FYP",
            poolConfig: poolConfig,
            platformReferrer: address(0),
            postDeployHook: address(0),
            postDeployHookData: "",
            coinSalt: freshSalt
        });

        console.log("Coin deployed at:", coin);

        // 3. Validation
       // Re-construct the PoolKey using the standard Zora V4 constants
        (address t0, address t1) = coin < WETH ? (coin, WETH) : (WETH, coin);
        
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(t0),
            currency1: Currency.wrap(t1),
            fee: 8388608,      // Standard Zora V4 Hook-managed fee
            tickSpacing: 200,  // Standard Zora V4 tick spacing
            hooks: IHooks(hookAddr) 
        });

        PoolId id = key.toId();
        (uint160 price, , , ) = IPoolManager(poolManagerAddr).getSlot0(id);

        console.log("-------------------------------------");
        console.log("New Coin Address:", coin);
        console.log("Confirmed Pool Price:", price);
        console.log("-------------------------------------");

        console.log("-------------------------------------");
        console.log("SUCCESS: Pool is live!");
        console.log("Pool ID:", uint256(PoolId.unwrap(id)));
        console.log("SqrtPriceX96:", price);
    
        console.log("-------------------------------------");

        vm.stopBroadcast();
    }
}