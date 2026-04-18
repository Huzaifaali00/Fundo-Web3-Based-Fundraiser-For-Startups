// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IZoraFactory {
    function deploy(
        address payoutRecipient,
        address[] calldata owners,
        string calldata uri,
        string calldata name,
        string calldata symbol,
        bytes calldata poolConfig,
        address platformReferrer,
        address postDeployHook,
        bytes calldata postDeployHookData,
        bytes32 coinSalt
    ) external payable returns (address coin, bytes memory postDeployHookDataOut);
}

contract Fundo {
    address public immutable Factory_Proxy;
    address public immutable PlatformReferrer;
    address[] public allcoins;

    mapping (address => address) public CoinDeployer;
    mapping (address => address[]) public DeployerCoins;
    
    event CoinDeployement(
        address indexed coin,
        address indexed owner,
        string uri,
        string name,
        string symbol
    );

    constructor(address _platformReferrer, address _Proxy) {
        PlatformReferrer = _platformReferrer;
        Factory_Proxy = _Proxy;
    }

    struct deployParams{
        address payoutRecipient;
        address[] owners;
        string uri;
        string name;
        string symbol;
        bytes  poolConfig;
        address postDeployHook;
        bytes postDeployHookData;
        bytes32 coinSalt;
    }

    function deploy_coin (deployParams calldata params) external payable returns (address coin, bytes memory postDeployHookDataOut){
        (coin, postDeployHookDataOut) = IZoraFactory(Factory_Proxy).deploy{value: msg.value}(
            params.payoutRecipient,
            params.owners,
            params.uri,
            params.name,
            params.symbol,
            params.poolConfig,
            PlatformReferrer,
            params.postDeployHook,
            params.postDeployHookData,
            params.coinSalt
        );

        allcoins.push(coin);
        CoinDeployer[coin] = msg.sender;
        DeployerCoins[msg.sender].push(coin);
        emit CoinDeployement(coin, msg.sender, params.uri, params.name, params.symbol);
        

    }

    function getDeployedCoinOwner(address coin) external view returns (address){
        return CoinDeployer[coin];
    } 

    function getOwnerDeployedCoins(address owner) external view returns (address[] memory){
        return DeployerCoins[owner];
        } 

    function getallCoins() external view returns (address[] memory){
        return allcoins;
    }

    function getCoinCount() external view returns (uint256){
        return allcoins.length;
    }

}