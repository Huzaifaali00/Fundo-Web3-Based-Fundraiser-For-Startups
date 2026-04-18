// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/fundo.sol";
import "@zora-protocol/coins/src/libs/CoinConfigurationVersions.sol";

contract FundoTest is Test {
    fundo public myFundo;
    address constant BASE_SEPOLIA_WETH = 0x4200000000000000000000000000000000000006;

    function setUp() public {
        vm.createSelectFork("https://sepolia.base.org");
        myFundo = new fundo();
    }

    function testDeployCoin() public {
        address[] memory owners = new address[](1);
        owners[0] = address(this);
        bytes memory validPoolConfig = CoinConfigurationVersions.defaultConfig(BASE_SEPOLIA_WETH);

        fundo.deployParams memory params = fundo.deployParams({
            payoutRecipient: address(this),
            owners: owners,
            uri: "ipfs://base-test",
            name: "Base Coin",
            symbol: "BASE",
            poolConfig: validPoolConfig,
            platformReferrer: address(0),
            postDeployHook: address(0),
            postDeployHookData: "",
            coinSalt: keccak256("base_salt_v1")
        });

        vm.prank(address(this));
        (address coin, ) = myFundo.deploy_coin(params);
        console.log(" Coin deployed at:", coin);
        assertTrue(coin != address(0));
    }
}