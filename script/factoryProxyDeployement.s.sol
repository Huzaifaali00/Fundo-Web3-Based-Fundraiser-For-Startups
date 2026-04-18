// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// A tiny implementation just to satisfy the Proxy check
contract Placeholder {
    function initialize(address) external {}
}

contract MasterDeployer is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("Private_Key");
        address deployerAddr = vm.addr(deployerPrivateKey);

        // 1. Deploy the placeholder logic (Uses Nonce 45 if done outside broadcast, 
        // but we'll do it inside to keep things simple if your nonce is currently 44).
        
        vm.startBroadcast(deployerPrivateKey);

        Placeholder logic = new Placeholder(); // This will be Nonce 44
        
        // 2. Prepare Init Data
        bytes memory initData = abi.encodeWithSelector(Placeholder.initialize.selector, deployerAddr);

        // 3. Deploy the Proxy
        // If Logic was Nonce 44, this is Nonce 45 -> Address 0xAe47...
        ERC1967Proxy proxy = new ERC1967Proxy(address(logic), initData);

        vm.stopBroadcast();

        console.log("LOGIC DEPLOYED AT:", address(logic));
        console.log("PROXY SECURED AT:", address(proxy));
    }
}