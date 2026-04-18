// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {ZoraV4CoinHook} from "../lib/zora-protocol/packages/coins/src/hooks/ZoraV4CoinHook.sol";
import {HookUpgradeGate} from "../lib/zora-protocol/packages/coins/src/hooks/HookUpgradeGate.sol";
import {ZoraHookRegistry} from "../lib/zora-protocol/packages/coins/src/hook-registry/ZoraHookRegistry.sol";
import {ZoraFactoryImpl} from "../lib/zora-protocol/packages/coins/src/ZoraFactoryImpl.sol";
import {TrustedMsgSenderProviderLookup} from "../lib/zora-protocol/packages/coins/src/utils/TrustedMsgSenderProviderLookup.sol";
import {ZoraLimitOrderBook} from "../lib/zora-protocol/packages/limit-orders/src/ZoraLimitOrderBook.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IDeployedCoinVersionLookup} from "../lib/zora-protocol/packages/coins/src/interfaces/IDeployedCoinVersionLookup.sol";
import {ITrustedMsgSenderProviderLookup} from "../lib/zora-protocol/packages/coins/src/interfaces/ITrustedMsgSenderProviderLookup.sol";
import {IHooksUpgradeGate} from "../lib/zora-protocol/packages/coins/src/interfaces/IHooksUpgradeGate.sol";
import {IZoraLimitOrderBookCoinsInterface} from "../lib/zora-protocol/packages/coins/src/interfaces/IZoraLimitOrderBookCoinsInterface.sol";
import {IZoraHookRegistry} from "../lib/zora-protocol/packages/coins/src/interfaces/IZoraHookRegistry.sol";

contract DeployFullCycle is Script {
    // ─────────────────────────────────────────────────────────────
    //  Constants — Base Sepolia infrastructure (never change)
    // ─────────────────────────────────────────────────────────────
    address constant CREATE2_DEPLOYER  = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant POOL_MANAGER     = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address constant UNIVERSAL_ROUTER = 0x492E6456D9528771018DeB9E87ef7750EF184104;
    address constant WETH             = 0x4200000000000000000000000000000000000006;

    // Coin implementation addresses (Zora-deployed on Base Sepolia — do not change)
    address constant COIN_V4_IMPL     = 0x0077C6D6e2B90Ad26914cc39C5b36e8B47BFAA99;
    address constant CREATOR_COIN_IMPL = 0xb22a3ee6e88F2Ab7fc7bD5A49aA3cFd3b3E25929;

    function run() external {
        address myWallet = 0x1822CBcb0aD767BF6abd81584D06401E2faf9b25;

        // ─────────────────────────────────────────────────────────
        //  STEP 1 — Predict all addresses before any deployment
        //
        //  Nonce map (relative to startNonce):
        //  +0  Registry Logic          (new ZoraHookRegistry)
        //  +1  Registry Proxy          (new ERC1967Proxy)
        //  +2  HookUpgradeGate         (new HookUpgradeGate)
        //  +3  Hook CREATE2 CALL       (CALL to CREATE2_DEPLOYER — consumes nonce, address from HookMiner)
        //  +4  Factory Logic           (new ZoraFactoryImpl)
        //  +5  addOwner() CALL         (CALL — consumes nonce, no contract)
        //  +6  Factory Proxy           (new ERC1967Proxy)
        //  +7  TrustedMsgSender        (new TrustedMsgSenderProviderLookup)
        //  +8  ZoraLimitOrderBook      (new ZoraLimitOrderBook)
        // ─────────────────────────────────────────────────────────
        uint256 startNonce = vm.getNonce(myWallet);

        address predRegistryLogic   = vm.computeCreateAddress(myWallet, startNonce);
        address predRegistryProxy   = vm.computeCreateAddress(myWallet, startNonce + 1);
        address predUpgradeGate     = vm.computeCreateAddress(myWallet, startNonce + 2);
        // startNonce + 3 is the CREATE2 CALL — hook address comes from HookMiner below
        address predFactoryLogic    = vm.computeCreateAddress(myWallet, startNonce + 4);
        // startNonce + 5 is addOwner() CALL — no contract address
        address predFactoryProxy    = vm.computeCreateAddress(myWallet, startNonce + 6);
        address predTrustedSender   = vm.computeCreateAddress(myWallet, startNonce + 7);
        address predLimitOrderBook  = vm.computeCreateAddress(myWallet, startNonce + 8);

        // ─────────────────────────────────────────────────────────
        //  STEP 2 — Mine hook address via CREATE2
        //  Hook flags: afterInitialize + beforeSwap + afterSwap
        // ─────────────────────────────────────────────────────────
        uint160 flags = Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;

        bytes memory constructorArgs = abi.encode(
            IPoolManager(POOL_MANAGER),
            IDeployedCoinVersionLookup(predFactoryProxy),               // coinVersionLookup_
            ITrustedMsgSenderProviderLookup(predTrustedSender),         // trustedMsgSenderLookup_
            IHooksUpgradeGate(predUpgradeGate),                         // upgradeGate_
            IZoraLimitOrderBookCoinsInterface(predLimitOrderBook),      // zoraLimitOrderBook_
            IZoraHookRegistry(predRegistryProxy)                        // zoraHookRegistry_
        );

        (address minedHookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            type(ZoraV4CoinHook).creationCode,
            constructorArgs
        );

        // ─────────────────────────────────────────────────────────
        //  STEP 3 — Deploy everything in nonce order
        // ─────────────────────────────────────────────────────────
        vm.startBroadcast();

        // [+0] Registry Logic
        ZoraHookRegistry regLogic = new ZoraHookRegistry();
        require(address(regLogic) == predRegistryLogic, "Registry Logic address mismatch");

        // [+1] Registry Proxy
        address[] memory owners = new address[](1);
        owners[0] = myWallet;
        ERC1967Proxy regProxy = new ERC1967Proxy(
            address(regLogic),
            abi.encodeWithSelector(ZoraHookRegistry.initialize.selector, owners)
        );
        require(address(regProxy) == predRegistryProxy, "Registry Proxy address mismatch");

        // [+2] HookUpgradeGate — owned by myWallet, manages hook migration paths
        HookUpgradeGate upgradeGate = new HookUpgradeGate(myWallet);
        require(address(upgradeGate) == predUpgradeGate, "UpgradeGate address mismatch");

        // [+3] Hook — CREATE2 via deployer (consumes nonce as a CALL)
        ZoraV4CoinHook hook = new ZoraV4CoinHook{salt: salt}(
            IPoolManager(POOL_MANAGER),
            IDeployedCoinVersionLookup(predFactoryProxy),
            ITrustedMsgSenderProviderLookup(predTrustedSender),
            IHooksUpgradeGate(predUpgradeGate),
            IZoraLimitOrderBookCoinsInterface(predLimitOrderBook),
            IZoraHookRegistry(predRegistryProxy)
        );
        require(address(hook) == minedHookAddress, "Hook address mismatch");

        // [+4] Factory Logic
        ZoraFactoryImpl factoryLogic = new ZoraFactoryImpl(
            COIN_V4_IMPL,
            CREATOR_COIN_IMPL,
            address(hook),
            address(regProxy)
        );
        require(address(factoryLogic) == predFactoryLogic, "Factory Logic address mismatch");

        // [+5] Authorize predicted factory proxy in registry (CALL — no contract)
        ZoraHookRegistry(address(regProxy)).addOwner(predFactoryProxy);

        // [+6] Factory Proxy
        ERC1967Proxy factoryProxy = new ERC1967Proxy(
            address(factoryLogic),
            abi.encodeWithSelector(ZoraFactoryImpl.initialize.selector, myWallet)
        );
        require(address(factoryProxy) == predFactoryProxy, "Factory Proxy address mismatch");

        // [+7] TrustedMsgSenderProviderLookup
        //      Seeds Universal Router as trusted on deploy.
        //      Owner can add/remove trusted senders later via addTrustedMsgSenderProviders().
        address[] memory trustedInit = new address[](1);
        trustedInit[0] = UNIVERSAL_ROUTER;
        TrustedMsgSenderProviderLookup trustedSender = new TrustedMsgSenderProviderLookup(
            trustedInit,
            myWallet
        );
        require(address(trustedSender) == predTrustedSender, "TrustedSender address mismatch");

        // [+8] ZoraLimitOrderBook
        //      zoraCoinVersionLookup = factoryProxy (tracks deployed coin versions)
        //      zoraHookRegistry      = regProxy     (knows which hooks are registered)
        //      create() is open to all callers by default (PermittedCallers sets PUBLIC_ACCESS=true)
        ZoraLimitOrderBook limitOrderBook = new ZoraLimitOrderBook(
            POOL_MANAGER,
            address(factoryProxy),
            address(regProxy),
            myWallet,
            WETH
        );
        require(address(limitOrderBook) == predLimitOrderBook, "LimitOrderBook address mismatch");

        // ─────────────────────────────────────────────────────────
        //  STEP 4 — Post-deploy wiring
        //  Register the hook as a valid upgrade target in HookUpgradeGate.
        //  This means the current hook can migrate TO itself (no-op path),
        //  and when you deploy a v2 hook in the future you simply call:
        //  upgradeGate.registerUpgradePath([currentHook], newHookAddress)
        // ─────────────────────────────────────────────────────────
        address[] memory currentHooks = new address[](1);
        currentHooks[0] = address(hook);
        upgradeGate.registerUpgradePath(currentHooks, address(hook));

        vm.stopBroadcast();

        // ─────────────────────────────────────────────────────────
        //  STEP 5 — Print summary (update React app with these)
        // ─────────────────────────────────────────────────────────
        console.log("----------------------------------------------");
        console.log("DEPLOYMENT SUCCESSFUL");
        console.log("----------------------------------------------");
        console.log("Registry Logic:    ", address(regLogic));
        console.log("Registry Proxy:    ", address(regProxy));
        console.log("HookUpgradeGate:   ", address(upgradeGate));
        console.log("Hook Address:      ", address(hook));
        console.log("Factory Logic:     ", address(factoryLogic));
        console.log("Factory Proxy:     ", address(factoryProxy));
        console.log("TrustedSender:     ", address(trustedSender));
        console.log("LimitOrderBook:    ", address(limitOrderBook));
        console.log("----------------------------------------------");
        console.log("UPDATE YOUR REACT APP:");
        console.log("  FACTORY_PROXY =", address(factoryProxy));
        console.log("  ZORA_HOOK     =", address(hook));
        console.log("----------------------------------------------");
    }
}
