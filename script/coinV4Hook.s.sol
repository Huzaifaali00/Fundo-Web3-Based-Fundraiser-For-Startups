// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {ZoraV4CoinHook} from "@zora-protocol/coins/src/hooks/ZoraV4CoinHook.sol"; // Adjust path as needed
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IDeployedCoinVersionLookup} from "@zora-protocol/coins/src/interfaces/IDeployedCoinVersionLookup.sol";
import {ITrustedMsgSenderProviderLookup} from "@zora-protocol/coins/src/interfaces/ITrustedMsgSenderProviderLookup.sol";
import {IHooksUpgradeGate} from "@zora-protocol/coins/src/interfaces/IHooksUpgradeGate.sol";
import {IZoraLimitOrderBookCoinsInterface} from "@zora-protocol/coins/src/interfaces/IZoraLimitOrderBookCoinsInterface.sol";
import {IZoraHookRegistry} from "@zora-protocol/coins/src/interfaces/IZoraHookRegistry.sol";

contract DeployHook is Script {
    function run() external {
      // This must match your getHookPermissions() exactly
uint160 flags = Hooks.AFTER_INITIALIZE_FLAG | 
                Hooks.BEFORE_SWAP_FLAG | 
                Hooks.AFTER_SWAP_FLAG;
        // 2. Prepare Constructor Args
        bytes memory constructorArgs = abi.encode(
            0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408, // PoolManager
            0x28f5484ceE1adDF640e294cf228d30666383fa89, // Predicted Factory
            0x777777751622c0d3258f214F9DF38E35BF45baF3, // TrustedMsg (Testnet Master)
            0x777777751622c0d3258f214F9DF38E35BF45baF3, // UpgradeGate (Testnet Master)
            0x777777751622c0d3258f214F9DF38E35BF45baF3, // OrderBook (Testnet Master)
            0x3a34F62bcBa4B091ADb28b369e559137CDF4F4c4                      // Replace with your Registry
        );

        // 3. Mine the Salt
        // Standard Create2 Deployer on most networks
        address CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
        
        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            type(ZoraV4CoinHook).creationCode,
            constructorArgs
        );

        console.log("Mined Salt:", vm.toString(salt));
        console.log("Target Hook Address:", hookAddress);

        // 4. Deploy (Broadcast)
        vm.startBroadcast();
        new ZoraV4CoinHook{salt: salt}(
            IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408),
            IDeployedCoinVersionLookup(0x28f5484ceE1adDF640e294cf228d30666383fa89),
            ITrustedMsgSenderProviderLookup(0x777777751622c0d3258f214F9DF38E35BF45baF3),
            IHooksUpgradeGate(0x777777751622c0d3258f214F9DF38E35BF45baF3),
            IZoraLimitOrderBookCoinsInterface(0x777777751622c0d3258f214F9DF38E35BF45baF3),
            IZoraHookRegistry(0x3a34F62bcBa4B091ADb28b369e559137CDF4F4c4)
            // ... add the rest of the casted interfaces here like we did in the previous step
        );
        vm.stopBroadcast();
    }
}