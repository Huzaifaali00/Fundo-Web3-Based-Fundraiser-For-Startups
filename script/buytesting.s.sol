// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol"; // <--- Add this

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract SwapTestScript is Script {
    using CurrencyLibrary for Currency;

    // Addresses from your successful deployment
    address constant poolManager = 0x0bfB2aD9f0959828469C967277636c87C0D0B953; // Base Sepolia PM
    address constant swapRouter = 0x7Da1D65F8B249183667cdE74C5CBD46dD38AA829;  // PoolSwapTest address
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant FYP = 0xf37D700D5423769b6b84523f2F25507FAfd62d6e;
    address constant HOOK = 0x30Bc80e895bb92F331f20e084dF487261d4Dd0c0;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("NEW_PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);
        IERC20(WETH).approve(poolManager, 1 ether);
IERC20(FYP).approve(poolManager, 1000000 ether);

// 2. Define the liquidity range (Must be within the Hook's allowed ticks)
// For Zora, they usually use a wide range.
int24 tickLower = -200000;
int24 tickUpper = 200000;
int256 liquidityDelta = 1e18; // Amount of "liquidity units" to add

console.log("Adding manual liquidity...");
IPoolManager(poolManager).modifyLiquidity(
    key, 
    IPoolManager.ModifyLiquidityParams({
        tickLower: tickLower,
        tickUpper: tickUpper,
        liquidityDelta: liquidityDelta,
        salt: 0
    }), 
    ""
);
        console.log("Pool Manager WETH balance:", IERC20(WETH).balanceOf(poolManager));

        // 1. Setup the PoolKey (Must match your deployment exactly)
        (address t0, address t1) = FYP < WETH ? (FYP, WETH) : (WETH, FYP);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(t0),
            currency1: Currency.wrap(t1),
            fee: 8388608, // Dynamic Fee Flag
            tickSpacing: 200,
            hooks: IHooks(HOOK)
        });

        // 2. Approve WETH to the Swap Router
        uint256 amountToSwap = 0.0001 ether; 
        IERC20(WETH).approve(swapRouter, amountToSwap);

        // 3. Configure Swap Settings
        // zeroForOne = true if WETH is currency0, false if FYP is currency0
        bool zeroForOne = (WETH < FYP);
        
        PoolSwapTest.TestSettings memory settings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });

        // 4. Execute Swap
        // -amountSpecified: negative value means "exact input"
        // sqrtPriceLimitX96: price boundary (using min/max for safety)
        // 4. Execute Swap
        // 4. Execute Swap
       // 4. Execute Swap
        int256 amountSpecified = -int256(amountToSwap); 
        uint160 sqrtPriceLimit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
bytes memory hookData = abi.encode(address(0));
        console.log("Executing swap...");
        
        // No "IPoolManager." prefix needed here now
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: sqrtPriceLimit
        });

        // Use the imported struct in the call
        PoolSwapTest(swapRouter).swap(
            key, 
            params, 
            settings, 
            hookData
        );

        console.log("Swap successful!");
        console.log("New FYP Balance:", IERC20(FYP).balanceOf(vm.addr(deployerPrivateKey)));
        vm.stopBroadcast();
    }
}