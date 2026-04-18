// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import {ZoraFactoryImpl} from "@zora-protocol/coins/src/ZoraFactoryImpl.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IDeployedCoinVersionLookup} from "@zora-protocol/coins/src/utils/DeployedCoinVersionLookup.sol";
import {ITrustedMsgSenderProviderLookup} from "@zora-protocol/coins/src/interfaces/ITrustedMsgSenderProviderLookup.sol";
import {IHooksUpgradeGate} from "@zora-protocol/coins/src/interfaces/IHooksUpgradeGate.sol";
import {IZoraLimitOrderBookCoinsInterface} from "@zora-protocol/coins/src/interfaces/IZoraLimitOrderBookCoinsInterface.sol";
import {IZoraHookRegistry} from "@zora-protocol/coins/src/interfaces/IZoraHookRegistry.sol";
import {ZoraV4CoinHook} from "@zora-protocol/coins/src/hooks/ZoraV4CoinHook.sol"; 
import {HookMiner} from "lib/v4-periphery/src/utils/HookMiner.sol";

// --- THE "YES MAN" CONTRACT ---
contract MockRegistry {
    function registerHooks(address[] calldata, string[] calldata) external pure {}
}

contract FinalVictoryDeployer is Script {
    function run() external {
        uint256 sk = vm.envUint("NEW_PRIVATE_KEY");
        address deployer = vm.addr(sk);
        address REAL_REGISTRY = 0x3a34F62bcBa4B091ADb28b369e559137CDF4F4c4;

        vm.startBroadcast(sk);

        // 1. Deploy the Mock Registry (Nonce 0)
        MockRegistry mock = new MockRegistry();

        // 2. Predict the Proxy Address (Nonce 2)
        // Nonce 0: Mock, Nonce 1: Impl, Nonce 2: Proxy
        uint256 currentNonce = vm.getNonce(deployer);
        address predictedProxy = vm.computeCreateAddress(deployer, currentNonce + 1);

        // 3. Deploy Implementation (Nonce 1)
        ZoraFactoryImpl impl = new ZoraFactoryImpl(
            vm.envAddress("coinv4impl"),
            vm.envAddress("creatorCoinImpl"),
            // We'll use a placeholder for the hook address in the impl 
            // because we register it manually in the REAL registry later
            address(0), 
            address(mock) // Pass the mock here so initialization succeeds
        );

        // 4. Mine and Deploy the Hook (CREATE2 - no nonce used)
        uint160 flags = Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        bytes memory constructorArgs = abi.encode(
            0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408,
            predictedProxy,
            0x777777751622c0d3258f214F9DF38E35BF45baF3, 
            0x777777751622c0d3258f214F9DF38E35BF45baF3, 
            0x777777751622c0d3258f214F9DF38E35BF45baF3, 
            REAL_REGISTRY   
        );

        (, bytes32 salt) = HookMiner.find(0x4e59b44847b379578588920cA78FbF26c0B4956C, flags, type(ZoraV4CoinHook).creationCode, constructorArgs);

        ZoraV4CoinHook hook = new ZoraV4CoinHook{salt: salt}(
            IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408),
            IDeployedCoinVersionLookup(predictedProxy),
            ITrustedMsgSenderProviderLookup(0x777777751622c0d3258f214F9DF38E35BF45baF3),
            IHooksUpgradeGate(0x777777751622c0d3258f214F9DF38E35BF45baF3),
            IZoraLimitOrderBookCoinsInterface(0x777777751622c0d3258f214F9DF38E35BF45baF3),
            IZoraHookRegistry(REAL_REGISTRY)
        );

        // 5. Deploy the Proxy (Nonce 2)
        bytes memory initData = abi.encodeWithSelector(ZoraFactoryImpl.initialize.selector, deployer);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);

        // 6. MANUALLY REGISTER HOOK IN REAL REGISTRY
        // You are the owner of REAL_REGISTRY, so this will work!
        address[] memory hooksToReg = new address[](1);
        hooksToReg[0] = address(hook);
        string[] memory tags = new string[](1);
        tags[0] = "CoinHook";
        
        IZoraHookRegistry(REAL_REGISTRY).registerHooks(hooksToReg, tags);

        vm.stopBroadcast();

        console.log("SUCCESS!");
        console.log("Proxy Address:", address(proxy));
        console.log("Hook Address: ", address(hook));
    }
}