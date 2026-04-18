//SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Fundo} from "src/fundo.sol";
import {Script} from "forge-std/Script.sol";

contract DeployFundo is Script{

    function run() external {
        address _platformReferrer = vm.envAddress("PLATFORMREFERRER");
        address _Proxy = vm.envAddress("FACTORY_PROXY");
        vm.startBroadcast();
        new Fundo(_platformReferrer, _Proxy);
        vm.stopBroadcast();
}
}