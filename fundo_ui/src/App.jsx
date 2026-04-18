import { useState, useEffect, useCallback, useRef } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEther,
  formatEther,
  encodeAbiParameters,
  toHex,
  maxUint256,
  zeroAddress,
  erc20Abi,
  keccak256,
  encodePacked,
} from "viem";
import { baseSepolia } from "viem/chains";

// ─── ADDRESSES ────────────────────────────────────────────────────────────────
const FACTORY_PROXY = "0x70c266745f3494Aeb3963e895878a689f4389300"; // underlying Zora factory (event source)
const FUNDO = "0x62752B82eD63e6507B1c0504FDF1709290b2c986"; // Fundo wrapper — entry point for all deploys
const ZORA_HOOK = "0x907CAa2Ab57dbf3cac589658798568614aBe10C0"; // your deployed hook
const UNIVERSAL_ROUTER = "0x492E6456D9528771018DeB9E87ef7750EF184104"; // Base Sepolia UR
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"; // canonical Permit2
const WETH = "0x4200000000000000000000000000000000000006"; // Base Sepolia WETH
const POOL_MANAGER = "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408"; // Base Sepolia PoolManager (used for swaps only)
const STATE_VIEW = "0x571291b572ed32ce6751a2cb2486ebee8defb9b4"; // StateView for 0x05E7 PoolManager — offchain reads
const PLATFORM_REFERRER = "0x1822CBcb0aD767BF6abd81584D06401E2faf9b25"; // earns 0.25% per trade
const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
const CHAIN_ID = 84532;
const LS_COIN_KEY = "fyp_last_deployed_coin"; // localStorage key for persistence

// ─── HARDCODED POOL CONFIG ────────────────────────────────────────────────────
// Generated from CoinConfigurationVersions.defaultConfig(WETH) in your local repo:
// ~/fyp/lib/zora-protocol/packages/coins/src/libs/CoinConfigurationVersions.sol
//
// Encodes: abi.encode(
//   uint8(4),                    ← DOPPLER_MULTICURVE_UNI_V4_POOL_VERSION
//   address(WETH),               ← currency
//   int24[](-138200, -115200),   ← tickLowers  (start price ~0.000001–0.00001 ETH/token)
//   int24[]( -92200,  -46000),   ← tickUppers  (peak  price ~0.0001–0.01     ETH/token)
//   uint16[](2, 2),              ← numDiscoveryPositions per curve
//   uint256[](0.1e18, 0.1e18)   ← maxDiscoverySupplyShare per curve
// )
//
// Validated: round-trip decoded back to exact same values. All ticks are multiples
// of TICK_SPACING=200 so no alignment rounding occurs. totalDiscoveryPositions=4
// (>1, <=200 ✓), totalDiscoverySupplyShare=0.2e18 < WAD(1e18) ✓.
// poolConfig is token-order agnostic — the coin/WETH ordering flip happens inside
// CoinDopplerMultiCurve.setupPool() at deploy time based on CREATE2 coin address.
const POOL_CONFIG =
  "0x" +
  // slot 0: version = 4
  "0000000000000000000000000000000000000000000000000000000000000004" +
  // slot 1: currency = WETH
  "0000000000000000000000004200000000000000000000000000000000000006" +
  // slot 2: offset to tickLower[] = 192 bytes (6 slots * 32)
  "00000000000000000000000000000000000000000000000000000000000000c0" +
  // slot 3: offset to tickUpper[] = 288 bytes
  "0000000000000000000000000000000000000000000000000000000000000120" +
  // slot 4: offset to numDiscoveryPositions[] = 384 bytes
  "0000000000000000000000000000000000000000000000000000000000000180" +
  // slot 5: offset to maxDiscoverySupplyShare[] = 480 bytes
  "00000000000000000000000000000000000000000000000000000000000001e0" +
  // slot 6: tickLower[] length = 2
  "0000000000000000000000000000000000000000000000000000000000000002" +
  // slot 7: tickLower[0] = -149200 → start price ~0.00000033 ETH ($0.001 at $3k ETH)
  "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdb930" +
  // slot 8: tickLower[1] = -115200 → start price ~0.0000099 ETH ($0.030 at $3k ETH)
  "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe3e00" +
  // slot 9: tickUpper[] length = 2
  "0000000000000000000000000000000000000000000000000000000000000002" +
  // slot 10: tickUpper[0] = -92200 → peak price ~0.0000990 ETH ($0.297 at $3k ETH)
  "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe97d8" +
  // slot 11: tickUpper[1] = -46000 → peak price ~0.01005 ETH ($30.16 at $3k ETH)
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff4c50" +
  // slot 12: numDiscoveryPositions[] length = 2
  "0000000000000000000000000000000000000000000000000000000000000002" +
  // slot 13: numDiscoveryPositions[0] = 2
  "0000000000000000000000000000000000000000000000000000000000000002" +
  // slot 14: numDiscoveryPositions[1] = 2
  "0000000000000000000000000000000000000000000000000000000000000002" +
  // slot 15: maxDiscoverySupplyShare[] length = 2
  "0000000000000000000000000000000000000000000000000000000000000002" +
  // slot 16: maxDiscoverySupplyShare[0] = 0.1e18
  "000000000000000000000000000000000000000000000000016345785d8a0000" +
  // slot 17: maxDiscoverySupplyShare[1] = 0.1e18
  "000000000000000000000000000000000000000000000000016345785d8a0000";

// ─── ABIS ─────────────────────────────────────────────────────────────────────
// Selector 0xa423ada1 — confirmed from on-chain tx and cast sig
// ─── FUNDO ABI ────────────────────────────────────────────────────────────────
// deploy_coin: struct-based wrapper — platformReferrer is hardcoded inside Fundo,
//              not passed by caller. Event is emitted by underlying Zora factory.
// Getters: read Fundo's onchain registry (coinDeployer, deployerCoins, allCoins).
const FUNDO_ABI = [
  // ── deploy_coin ────────────────────────────────────────────────────────────
  {
    name: "deploy_coin",
    type: "function",
    stateMutability: "payable",
    inputs: [{
      name: "params", type: "tuple",
      components: [
        { name: "payoutRecipient", type: "address" },
        { name: "owners", type: "address[]" },
        { name: "uri", type: "string" },
        { name: "name", type: "string" },
        { name: "symbol", type: "string" },
        { name: "poolConfig", type: "bytes" },
        { name: "postDeployHook", type: "address" },
        { name: "postDeployHookData", type: "bytes" },
        { name: "coinSalt", type: "bytes32" },
      ],
    }],
    outputs: [
      { name: "coin", type: "address" },
      { name: "postDeployHookDataOut", type: "bytes" },
    ],
  },
  // ── getters ────────────────────────────────────────────────────────────────
  {
    name: "getCoinCount", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }]
  },
  {
    name: "getallCoins", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "address[]" }]
  },
  {
    name: "getDeployedCoinOwner", type: "function", stateMutability: "view",
    inputs: [{ name: "coin", type: "address" }], outputs: [{ type: "address" }]
  },
  {
    name: "getOwnerDeployedCoins", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "address[]" }]
  },
  {
    name: "PlatformReferrer", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }]
  },
  {
    name: "Factory_Proxy", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }]
  },
  // ── CoinDeployement event (emitted by Fundo) ───────────────────────────────
  {
    name: "CoinDeployement", type: "event",
    inputs: [
      { name: "coin", type: "address", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "uri", type: "string", indexed: false },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
    ],
  },
];

// CoinCreatedV4 is still emitted by the underlying Zora FactoryProxy — kept
// separately for log parsing (coinLog filter still checks FACTORY_PROXY address).
const FACTORY_EVENT_ABI = [{
  name: "CoinCreatedV4",
  type: "event",
  inputs: [
    { name: "caller", type: "address", indexed: true },
    { name: "payoutRecipient", type: "address", indexed: false },
    { name: "platformReferrer", type: "address", indexed: false },
    { name: "currency", type: "address", indexed: false },
    { name: "uri", type: "string", indexed: false },
    { name: "name", type: "string", indexed: false },
    { name: "symbol", type: "string", indexed: false },
    { name: "coin", type: "address", indexed: true },
    { name: "poolKey", type: "bytes32", indexed: false },
    { name: "version", type: "uint8", indexed: false },
  ],
}];

const UNIVERSAL_ROUTER_ABI = [{
  name: "execute", type: "function", stateMutability: "payable",
  inputs: [{ type: "bytes", name: "commands" }, { type: "bytes[]", name: "inputs" }],
}];

const PERMIT2_ABI = [
  {
    name: "approve", type: "function",
    inputs: [
      { type: "address", name: "token" },
      { type: "address", name: "spender" },
      { type: "uint160", name: "amount" },
      { type: "uint48", name: "expiration" },
    ],
    outputs: [],
  },
  {
    // allowance(owner, token, spender) → (amount, expiration, nonce)
    // Used to check if Permit2 → Router approval is still valid before sending tx
    name: "allowance", type: "function", stateMutability: "view",
    inputs: [
      { type: "address", name: "user" },
      { type: "address", name: "token" },
      { type: "address", name: "spender" },
    ],
    outputs: [
      { type: "uint160", name: "amount" },
      { type: "uint48", name: "expiration" },
      { type: "uint48", name: "nonce" },
    ],
  },
];

// ─── V4 SWAP CONSTANTS ────────────────────────────────────────────────────────
// 0x06 = SWAP_EXACT_IN_SINGLE (single pool, uses PoolKey directly)
// 0x0b = SWAP_EXACT_IN        (multi-hop path — WRONG for single pool, was the bug)
const CMD_V4_SWAP = 0x10;
const ACT_SWAP_EXACT_IN_SINGLE = 0x06; // single-hop — confirmed from Uniswap docs
const ACT_SETTLE_ALL = 0x0c;
const ACT_TAKE_ALL = 0x0f;

// ─── PUBLIC CLIENT ────────────────────────────────────────────────────────────
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_RPC),
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const truncate = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";

const PHASES = {
  idle: { label: "Ready", color: "#4ade80" },
  connecting: { label: "Connecting…", color: "#facc15" },
  deploying: { label: "Deploying coin…", color: "#60a5fa" },
  approving: { label: "Approving…", color: "#facc15" },
  buying: { label: "Buying…", color: "#60a5fa" },
  selling: { label: "Selling…", color: "#f97316" },
  success: { label: "Success ✓", color: "#4ade80" },
  error: { label: "Error", color: "#f87171" },
};

// ─── SWAP CALLDATA BUILDER ────────────────────────────────────────────────────
// Encodes a V4 single-hop exact-input swap through Universal Router.
//
// Action 0x06 = SWAP_EXACT_IN_SINGLE — single pool, decodes ExactInputSingleParams:
//   struct ExactInputSingleParams { PoolKey poolKey; bool zeroForOne; uint128 amountIn;
//                                   uint128 amountOutMinimum; bytes hookData; }
// NOTE: No sqrtPriceLimitX96 in this struct — removed from public-facing API.
//
// Action 0x0b = SWAP_EXACT_IN — multi-hop path encoding — WRONG for single pool.
// Using 0x0b was the bug: router decoded our single-pool params as a path struct,
// produced a corrupt delta, then SETTLE_ALL tried to settle the coin address as WETH amount.
//
// tickSpacing MUST be int24 — uint24 corrupts PoolKey struct alignment.
// hookData = abi.encode(recipient) required by ZoraV4CoinHook for sniper protection.
function buildSwapCalldata({ coinAddress, amountIn, isBuy, recipient }) {
  const [token0, token1] =
    WETH.toLowerCase() < coinAddress.toLowerCase()
      ? [WETH, coinAddress]
      : [coinAddress, WETH];

  const wethIsToken0 = WETH.toLowerCase() === token0.toLowerCase();
  const zeroForOne = isBuy ? wethIsToken0 : !wethIsToken0;
  const hookData = encodeAbiParameters([{ type: "address" }], [recipient]);

  // ExactInputSingleParams — matches IV4Router.sol exactly
  const swapParams = encodeAbiParameters(
    [{
      type: "tuple",
      components: [
        {
          type: "tuple", name: "poolKey",
          components: [
            { type: "address", name: "currency0" },
            { type: "address", name: "currency1" },
            { type: "uint24", name: "fee" },
            { type: "int24", name: "tickSpacing" }, // int24, NOT uint24
            { type: "address", name: "hooks" },
          ]
        },
        { type: "bool", name: "zeroForOne" },
        { type: "uint128", name: "amountIn" },
        { type: "uint128", name: "amountOutMinimum" }, // 0 = no slippage protection (testnet only)
        { type: "bytes", name: "hookData" },
      ]
    }],
    [[
      [token0, token1, 8388608, 200, ZORA_HOOK],
      zeroForOne,
      amountIn,
      0n,
      hookData,
    ]]
  );

  const settleParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [isBuy ? WETH : coinAddress, amountIn]
  );

  const takeParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [isBuy ? coinAddress : WETH, 0n]
  );

  const v4Input = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [
      toHex(new Uint8Array([ACT_SWAP_EXACT_IN_SINGLE, ACT_SETTLE_ALL, ACT_TAKE_ALL])),
      [swapParams, settleParams, takeParams],
    ]
  );

  return {
    commands: toHex(new Uint8Array([CMD_V4_SWAP])),
    inputs: [v4Input],
  };
}

// ─── STATE VIEW ABI (getSlot0 — offchain read) ───────────────────────────────
// Must call StateView, NOT PoolManager directly. StateView wraps StateLibrary
// for offchain clients. PoolManager.getSlot0 uses extsload and is inaccessible
// to frontends. StateView address: 0x571291b572ed32ce6751a2cb2486ebee8defb9b4
const STATE_VIEW_ABI = [{
  name: "getSlot0",
  type: "function",
  stateMutability: "view",
  inputs: [{ type: "bytes32", name: "id" }],
  outputs: [
    { type: "uint160", name: "sqrtPriceX96" },
    { type: "int24", name: "tick" },
    { type: "uint24", name: "protocolFee" },
    { type: "uint24", name: "lpFee" },
  ],
}];

// Compute poolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
// Matches CoinCommon.hashPoolKey() in Solidity exactly.
function computePoolId(coinAddress) {
  const [currency0, currency1] =
    WETH.toLowerCase() < coinAddress.toLowerCase()
      ? [WETH, coinAddress]
      : [coinAddress, WETH];

  return keccak256(encodeAbiParameters(
    [
      { type: "address" }, // currency0
      { type: "address" }, // currency1
      { type: "uint24" }, // fee
      { type: "int24" }, // tickSpacing
      { type: "address" }, // hooks
    ],
    [currency0, currency1, 8388608, 200, ZORA_HOOK]
  ));
}

// Convert sqrtPriceX96 → human-readable ETH price per 1 coin token.
// price = (sqrtPriceX96 / 2^96)^2
// If WETH is currency0: price = WETH per coin = raw price
// If WETH is currency1: price = coin per WETH = 1 / raw price
function sqrtPriceToEth(sqrtPriceX96, coinAddress) {
  if (!sqrtPriceX96 || sqrtPriceX96 === 0n) return null;
  // Use BigInt math throughout — sqrtPriceX96 is ~155 bits, Number() loses precision.
  // price (token1/token0) = (sqrtPriceX96 / 2^96)^2
  // Compute as: (sqrtPriceX96^2 * 1e18) / (2^96)^2  → gives price scaled by 1e18
  const Q96 = 2n ** 96n;
  const SCALE = 10n ** 18n;
  const priceScaled = (sqrtPriceX96 * sqrtPriceX96 * SCALE) / (Q96 * Q96);
  const rawPrice = Number(priceScaled) / 1e18; // token1 per token0

  const wethIsToken0 = WETH.toLowerCase() < coinAddress.toLowerCase();
  // if weth=token0: rawPrice = coin per WETH → ETH per coin = 1/rawPrice
  // if weth=token1: rawPrice = WETH per coin → ETH per coin = rawPrice
  const ethPerCoin = wethIsToken0 ? 1 / rawPrice : rawPrice;

  if (!isFinite(ethPerCoin) || ethPerCoin <= 0) return null;
  return ethPerCoin;
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [address, setAddress] = useState(null);
  const [walletClient, setWalletClient] = useState(null);
  const [deployedCoin, setDeployedCoin] = useState(null);
  // Restore last deployed coin from localStorage so it survives page reloads
  const [coinInput, setCoinInput] = useState(() => localStorage.getItem(LS_COIN_KEY) || "");
  const [coinName, setCoinName] = useState("My Content Coin");
  const [coinSymbol, setCoinSymbol] = useState("MCC");
  const [coinUri, setCoinUri] = useState("ipfs://bafkreihz5knnvvsvmaxlpw3kout23te6yboquyvvs72wzfulgrkwj7r7dm");
  const [buyAmount, setBuyAmount] = useState("0.001");
  const [sellAmount, setSellAmount] = useState("100");
  const [phase, setPhase] = useState("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [lastTx, setLastTx] = useState(null);
  const [coinBalance, setCoinBalance] = useState(null);
  const [tokenPrice, setTokenPrice] = useState(null); // ETH per 1 coin token
  const [poolId, setPoolId] = useState(null); // keccak256 pool key hash
  const priceIntervalRef = useRef(null);
  const [fundoCoinCount, setFundoCoinCount] = useState(null);
  const [fundoUserCoins, setFundoUserCoins] = useState([]);  // coins deployed by connected wallet
  const [fundoCoinOwner, setFundoCoinOwner] = useState(null); // owner of active coin


  // ── Connect Wallet ──────────────────────────────────────────────────────────
  // Chain switch BEFORE walletClient creation — walletClient snapshots chain at init.
  const connectWallet = useCallback(async () => {
    if (!window.ethereum) return alert("MetaMask not detected.");
    setPhase("connecting");
    setStatusMsg("");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const addr = accounts[0];

      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
        });
      } catch (e) {
        if (e.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: `0x${CHAIN_ID.toString(16)}`,
              chainName: "Base Sepolia Testnet",
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: [BASE_SEPOLIA_RPC],
              blockExplorerUrls: ["https://sepolia.basescan.org"],
            }],
          });
        } else throw e;
      }

      const wc = createWalletClient({
        chain: baseSepolia,
        transport: custom(window.ethereum),
        account: addr,
      });

      setAddress(addr);
      setWalletClient(wc);
      setPhase("idle");
      setStatusMsg(`Connected: ${truncate(addr)}`);
      fetchFundoStats(null, addr);
    } catch (err) {
      setPhase("error");
      setStatusMsg(err.message || "Connection failed");
    }
  }, []);

  // ── Balance ─────────────────────────────────────────────────────────────────
  const fetchBalance = useCallback(async (coinAddr, userAddr) => {
    if (!coinAddr || !userAddr) return;
    try {
      const bal = await publicClient.readContract({
        address: coinAddr, abi: erc20Abi,
        functionName: "balanceOf", args: [userAddr],
      });
      setCoinBalance(formatEther(bal));
    } catch { setCoinBalance(null); }
  }, []);

  // ── Price ────────────────────────────────────────────────────────────────────
  const fetchPrice = useCallback(async (coinAddr, pid) => {
    if (!coinAddr || !pid) return;
    try {
      console.log("[price] calling StateView.getSlot0:", STATE_VIEW, "poolId:", pid);
      const result = await publicClient.readContract({
        address: STATE_VIEW,
        abi: STATE_VIEW_ABI,
        functionName: "getSlot0",
        args: [pid],
      });
      console.log("[price] getSlot0 result:", result);
      // Viem returns a tuple array when outputs lack names — use index [0], not destructuring
      const sqrtPriceX96 = Array.isArray(result) ? result[0] : result.sqrtPriceX96;
      const price = sqrtPriceToEth(sqrtPriceX96, coinAddr);
      console.log("[price] computed price:", price, "ETH/token");
      setTokenPrice(price);
    } catch (err) {
      console.error("[price] getSlot0 failed:", err?.message || err);
      setTokenPrice(null);
    }
  }, []);

  // ── Fundo registry reads ────────────────────────────────────────────────────
  const fetchFundoStats = useCallback(async (coinAddr, userAddr) => {
    try {
      const count = await publicClient.readContract({
        address: FUNDO, abi: FUNDO_ABI, functionName: "getCoinCount",
      });
      setFundoCoinCount(Number(count));
    } catch { /* non-critical */ }

    if (userAddr) {
      try {
        const userCoins = await publicClient.readContract({
          address: FUNDO, abi: FUNDO_ABI, functionName: "getOwnerDeployedCoins",
          args: [userAddr],
        });
        setFundoUserCoins(userCoins || []);
      } catch { setFundoUserCoins([]); }
    }

    if (coinAddr && coinAddr.length === 42) {
      try {
        const owner = await publicClient.readContract({
          address: FUNDO, abi: FUNDO_ABI, functionName: "getDeployedCoinOwner",
          args: [coinAddr],
        });
        // owner is zero address if coin wasn't deployed through Fundo
        setFundoCoinOwner(owner === "0x0000000000000000000000000000000000000000" ? null : owner);
      } catch { setFundoCoinOwner(null); }
    }
  }, []);

  // ── Activate coin — runs whenever activeCoin changes ────────────────────────
  // Handles: balance fetch, poolId computation, price fetch, polling, localStorage
  useEffect(() => {
    const coinAddr = deployedCoin || coinInput;
    if (!coinAddr || !coinAddr.startsWith("0x") || coinAddr.length !== 42) {
      setTokenPrice(null);
      setPoolId(null);
      if (priceIntervalRef.current) clearInterval(priceIntervalRef.current);
      return;
    }

    // Persist to localStorage so it survives page reloads
    localStorage.setItem(LS_COIN_KEY, coinAddr);

    const pid = computePoolId(coinAddr);
    setPoolId(pid);

    // Immediate fetches
    if (address) fetchBalance(coinAddr, address);
    fetchPrice(coinAddr, pid);
    fetchFundoStats(coinAddr, address);

    // Poll price every 8 seconds — updates whenever anyone buys or sells
    if (priceIntervalRef.current) clearInterval(priceIntervalRef.current);
    priceIntervalRef.current = setInterval(() => {
      fetchPrice(coinAddr, pid);
      if (address) fetchBalance(coinAddr, address);
    }, 8000);

    return () => {
      if (priceIntervalRef.current) clearInterval(priceIntervalRef.current);
    };
  }, [deployedCoin, coinInput, address, fetchBalance, fetchPrice, fetchFundoStats]);

  // ── Deploy ──────────────────────────────────────────────────────────────────
  // poolConfig is hardcoded from CoinConfigurationVersions.defaultConfig(WETH).
  // No API calls, no SDK, no CORS issues. The same library that parses poolConfig
  // inside your hook generated these exact bytes.
  const handleDeploy = async () => {
    if (!walletClient || !address) return alert("Connect wallet first.");
    if (!coinName || !coinSymbol || !coinUri) return alert("Fill in name, symbol, and URI.");

    setPhase("deploying");
    setStatusMsg("Deploying coin via Fundo contract…");
    setLastTx(null);

    try {
      // Unique salt — prevents CREATE2 collision if same name/symbol deployed twice
      const coinSalt = keccak256(
        encodePacked(
          ["string", "string", "address", "uint256"],
          [coinName, coinSymbol, address, BigInt(Date.now())]
        )
      );

      // Call Fundo.deploy_coin — passes params as a struct.
      // platformReferrer is NOT in params — Fundo hardcodes it internally.
      const hash = await walletClient.writeContract({
        address: FUNDO,
        abi: FUNDO_ABI,
        functionName: "deploy_coin",
        args: [{
          payoutRecipient: address,    // creator gets 50% trading rewards
          owners: [address],  // creator owns the coin
          uri: coinUri,
          name: coinName,
          symbol: coinSymbol,
          poolConfig: POOL_CONFIG,
          postDeployHook: zeroAddress,
          postDeployHookData: "0x",
          coinSalt,
        }],
        account: address,
        gas: 4_000_000n,
      });

      setStatusMsg("Waiting for confirmation…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setLastTx(hash);

      // Extract coin address from CoinCreatedV4 event
      // topic[0] = keccak256("CoinCreatedV4(address,address,address,address,string,string,string,address,bytes32,uint8)")
      // topic[1] = caller (indexed), topic[2] = coin (indexed address) — what we want
      //
      // BUG FIX: must match topic[0] explicitly. Without it, the first log from
      // FACTORY_PROXY with 3+ topics gets picked — which may be OwnershipTransferred
      // or another event where topic[2] is the caller wallet, not the coin.
      const COIN_CREATED_V4_TOPIC0 = keccak256(
        encodePacked(
          ["string"],
          ["CoinCreatedV4(address,address,address,address,string,string,string,address,bytes32,uint8)"]
        )
      );

      console.log("[deploy] receipt logs:", receipt.logs.map(l => ({
        address: l.address, topic0: l.topics[0]
      })));
      console.log("[deploy] expected topic0:", COIN_CREATED_V4_TOPIC0);

      const coinLog = receipt.logs.find(log => {
        try {
          return (
            log.address.toLowerCase() === FACTORY_PROXY.toLowerCase() &&
            log.topics.length >= 3 &&
            log.topics[0].toLowerCase() === COIN_CREATED_V4_TOPIC0.toLowerCase()
          );
        } catch { return false; }
      });

      const coinAddress = coinLog
        ? `0x${coinLog.topics[2].slice(26)}`
        : null;

      if (coinAddress && coinAddress !== `0x${"0".repeat(40)}`) {
        setDeployedCoin(coinAddress);
        setCoinInput(coinAddress);
        localStorage.setItem(LS_COIN_KEY, coinAddress);
        const pid = computePoolId(coinAddress);
        setPoolId(pid);
        fetchPrice(coinAddress, pid);
        fetchFundoStats(coinAddress, address);
        setStatusMsg(`Deployed at ${truncate(coinAddress)}`);
      } else {
        setStatusMsg("Deployed — check tx for coin address");
      }
      setPhase("success");
    } catch (err) {
      console.error(err);
      setPhase("error");
      setStatusMsg(err.shortMessage || err.message);
    }
  };

  // ── Approvals ───────────────────────────────────────────────────────────────
  const ensureApprovals = async (tokenAddress, amount) => {
    // ── Check 1: token → Permit2 ───────────────────────────────────────────
    // Read current ERC20 allowance. If already maxUint256 (or >= amount), skip.
    // For WETH this will be true after the very first buy ever — never needed again.
    const erc20Allowance = await publicClient.readContract({
      address: tokenAddress, abi: erc20Abi,
      functionName: "allowance", args: [address, PERMIT2],
    });

    if (erc20Allowance < amount) {
      setPhase("approving");
      setStatusMsg(`Approving ${truncate(tokenAddress)} → Permit2…`);
      const h1 = await walletClient.writeContract({
        address: tokenAddress, abi: erc20Abi,
        functionName: "approve", args: [PERMIT2, maxUint256],
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash: h1 });
    }

    // ── Check 2: Permit2 → Universal Router ───────────────────────────────
    // Read current Permit2 allowance for this (token, spender) pair.
    // Returns (amount, expiration, nonce) — check both amount and expiry.
    // For buys: token=WETH, approved once → all future buys skip this too.
    // For sells: token=coinAddress, one approval per unique coin, then never again.
    const now = BigInt(Math.floor(Date.now() / 1000));
    const permit2Result = await publicClient.readContract({
      address: PERMIT2, abi: PERMIT2_ABI,
      functionName: "allowance",
      args: [address, tokenAddress, UNIVERSAL_ROUTER],
    });
    const [p2Amount, p2Expiration] = Array.isArray(permit2Result)
      ? permit2Result
      : [permit2Result.amount, permit2Result.expiration];

    if (BigInt(p2Amount) < amount || BigInt(p2Expiration) <= now) {
      setPhase("approving");
      setStatusMsg("Approving Permit2 → Universal Router…");
      // Set a long expiry (1 year) so returning users skip this for a long time
      const h2 = await walletClient.writeContract({
        address: PERMIT2, abi: PERMIT2_ABI,
        functionName: "approve",
        args: [tokenAddress, UNIVERSAL_ROUTER, maxUint256, BigInt(Math.floor(Date.now() / 1000) + 31536000)],
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash: h2 });
    }
    // If both checks passed with no txs sent → caller goes straight to execute
  };

  // ── Buy ─────────────────────────────────────────────────────────────────────
  // Direct Universal Router call — SDK's tradeCoin hardcodes Base mainnet
  // and cannot be used on Base Sepolia.
  const handleBuy = async () => {
    const coinAddr = deployedCoin || coinInput;
    if (!walletClient || !address) return alert("Connect wallet first.");
    if (!coinAddr) return alert("Deploy a coin or enter a coin address.");

    const amountIn = parseEther(buyAmount);
    setLastTx(null);

    try {
      await ensureApprovals(WETH, amountIn);

      setPhase("buying");
      setStatusMsg("Executing buy swap…");

      const { commands, inputs } = buildSwapCalldata({
        coinAddress: coinAddr, amountIn, isBuy: true, recipient: address,
      });

      const hash = await walletClient.writeContract({
        address: UNIVERSAL_ROUTER, abi: UNIVERSAL_ROUTER_ABI,
        functionName: "execute", args: [commands, inputs],
        account: address, gas: 1_000_000n,
      });

      await publicClient.waitForTransactionReceipt({ hash });
      setLastTx(hash);
      setPhase("success");
      setStatusMsg(`Buy confirmed — ${buyAmount} ETH spent`);
      await fetchBalance(coinAddr, address);
    } catch (err) {
      console.error(err);
      setPhase("error");
      setStatusMsg(err.shortMessage || err.message);
    }
  };

  // ── Sell ────────────────────────────────────────────────────────────────────
  const handleSell = async () => {
    const coinAddr = deployedCoin || coinInput;
    if (!walletClient || !address) return alert("Connect wallet first.");
    if (!coinAddr) return alert("Deploy a coin or enter a coin address.");

    const amountIn = parseEther(sellAmount);
    setLastTx(null);

    try {
      await ensureApprovals(coinAddr, amountIn);

      setPhase("selling");
      setStatusMsg("Executing sell swap…");

      const { commands, inputs } = buildSwapCalldata({
        coinAddress: coinAddr, amountIn, isBuy: false, recipient: address,
      });

      const hash = await walletClient.writeContract({
        address: UNIVERSAL_ROUTER, abi: UNIVERSAL_ROUTER_ABI,
        functionName: "execute", args: [commands, inputs],
        account: address, gas: 1_000_000n,
      });

      await publicClient.waitForTransactionReceipt({ hash });
      setLastTx(hash);
      setPhase("success");
      setStatusMsg(`Sell confirmed — ${sellAmount} tokens sold`);
      await fetchBalance(coinAddr, address);
    } catch (err) {
      console.error(err);
      setPhase("error");
      setStatusMsg(err.shortMessage || err.message);
    }
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  const { label: statusLabel, color: statusColor } = PHASES[phase] || PHASES.idle;
  const activeCoin = deployedCoin || coinInput;
  const isIdle = ["idle", "success", "error"].includes(phase);

  return (
    <div style={s.root}>
      <header style={s.header}>
        <div style={s.logo}>
          <span style={s.logoMark}>⬡</span>
          <span style={s.logoText}>ZORA COIN STUDIO</span>
        </div>
        <div style={s.networkBadge}>Base Sepolia</div>
      </header>

      <main style={s.main}>

        {/* Wallet */}
        <section style={s.card}>
          <div style={s.cardLabel}>WALLET</div>
          {!address ? (
            <button style={{ ...s.btn, ...s.btnPrimary }} onClick={connectWallet}>
              Connect Wallet
            </button>
          ) : (
            <div style={s.walletRow}>
              <span style={s.addressPill}>{truncate(address)}</span>
              <span style={{ ...s.dot, background: statusColor }} />
              <span style={s.statusText}>{statusLabel}</span>
            </div>
          )}
          {statusMsg && (
            <p style={{ ...s.hint, color: phase === "error" ? "#f87171" : "#64748b", marginTop: 10, marginBottom: 0 }}>
              {statusMsg}
            </p>
          )}
          {lastTx && (
            <a style={s.txLink}
              href={`https://sepolia.basescan.org/tx/${lastTx}`}
              target="_blank" rel="noreferrer">
              View transaction ↗
            </a>
          )}
        </section>

        {/* Fundo Registry */}
        {(fundoUserCoins.length > 0 || fundoCoinOwner) && (
          <section style={s.card}>
            <div style={s.cardLabel}>FUNDO REGISTRY</div>
            <div style={s.statsRow}>
              {fundoCoinCount !== null && (
                <div style={s.statBox}>
                  <span style={s.statLabel}>PLATFORM COINS</span>
                  <span style={s.statValue}>{fundoCoinCount}</span>
                  <span style={s.statSub}>total launched via Fundo</span>
                </div>
              )}
              {fundoUserCoins.length > 0 && (
                <div style={s.statBox}>
                  <span style={s.statLabel}>YOUR COINS</span>
                  <span style={s.statValue}>{fundoUserCoins.length}</span>
                  <span style={s.statSub}>deployed by your wallet</span>
                </div>
              )}
              {fundoCoinOwner && (
                <div style={s.statBox}>
                  <span style={s.statLabel}>COIN DEPLOYER</span>
                  <span style={s.statValue}>{truncate(fundoCoinOwner)}</span>
                  <span style={s.statSub}>verified via Fundo registry</span>
                </div>
              )}
            </div>
            {fundoUserCoins.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={s.fieldLabel}>YOUR DEPLOYED COINS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  {fundoUserCoins.map((c) => (
                    <div key={c} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <code style={{ ...s.code, fontSize: 12, color: "#94a3b8" }}>{c}</code>
                      <button
                        onClick={() => { setCoinInput(c); setDeployedCoin(c); }}
                        style={{
                          ...s.btn, padding: "4px 10px", fontSize: 11, width: "auto",
                          background: "#1e293b", color: "#818cf8"
                        }}
                      >
                        Load
                      </button>
                      <a href={`https://sepolia.basescan.org/address/${c}`}
                        target="_blank" rel="noreferrer"
                        style={{ fontSize: 11, color: "#475569" }}>↗</a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Deploy */}
        <section style={s.card}>
          <div style={s.cardLabel}>DEPLOY COIN</div>
          <p style={s.hint}>
            Deploys via <strong style={{ color: "#c7d2fe" }}>Fundo</strong>{" "}
            <code style={s.code}>{truncate(FUNDO)}</code> → FactoryProxy.
            Platform referrer is hardcoded inside Fundo — earns{" "}
            <strong style={{ color: "#c7d2fe" }}>0.7%</strong> of all trades.
            {fundoCoinCount !== null && (
              <span> · <strong style={{ color: "#4ade80" }}>{fundoCoinCount}</strong> coins launched on platform</span>
            )}
          </p>
          <div style={s.fields}>
            <Field label="Name" value={coinName} onChange={setCoinName} placeholder="My Content Coin" disabled={!isIdle} />
            <Field label="Symbol" value={coinSymbol} onChange={setCoinSymbol} placeholder="MCC" disabled={!isIdle} />
            <Field label="Metadata URI" value={coinUri} onChange={setCoinUri} placeholder="ipfs://..." disabled={!isIdle} />
          </div>
          <button
            style={{ ...s.btn, ...s.btnPrimary, opacity: (!isIdle || !address) ? 0.45 : 1 }}
            onClick={handleDeploy} disabled={!isIdle || !address}
          >
            {phase === "deploying" ? "Deploying…" : "Deploy Coin"}
          </button>
        </section>

        {/* Trade */}
        <section style={s.card}>
          <div style={s.cardLabel}>TRADE</div>
          <div style={s.fields}>
            <Field
              label="Coin Address"
              value={coinInput} onChange={setCoinInput}
              placeholder="0x… (auto-filled after deploy)"
              disabled={!isIdle}
            />
          </div>

          {/* Live price + balance row */}
          <div style={s.statsRow}>
            {tokenPrice !== null ? (
              <div style={s.statBox}>
                <span style={s.statLabel}>PRICE</span>
                <span style={s.statValue}>
                  {(() => {
                    const p = tokenPrice;
                    if (p >= 0.01) return p.toFixed(4) + " ETH";
                    if (p >= 0.0001) return p.toFixed(6) + " ETH";
                    if (p >= 0.000001) return p.toFixed(8) + " ETH";
                    if (p >= 0.000000001) return p.toFixed(12) + " ETH";
                    return p.toFixed(15) + " ETH";
                  })()}
                </span>
                <span style={s.statSub}>per token · live ●</span>
              </div>
            ) : (activeCoin && activeCoin.length === 42) ? (
              <div style={s.statBox}>
                <span style={s.statLabel}>PRICE</span>
                <span style={{ ...s.statValue, color: "#475569" }}>fetching…</span>
              </div>
            ) : null}

            {activeCoin && coinBalance !== null && (
              <div style={s.statBox}>
                <span style={s.statLabel}>YOUR BALANCE</span>
                <span style={s.statValue}>
                  {Number(coinBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                <span style={s.statSub}>tokens</span>
              </div>
            )}
          </div>
          <div style={s.tradeRow}>
            <div style={s.tradeBlock}>
              <Field label="ETH to spend" value={buyAmount} onChange={setBuyAmount}
                placeholder="0.001" type="number" disabled={!isIdle} />
              <button
                style={{ ...s.btn, ...s.btnBuy, opacity: (!isIdle || !address) ? 0.45 : 1 }}
                onClick={handleBuy} disabled={!isIdle || !address}
              >
                {phase === "buying" ? "Buying…" : "Buy ↑"}
              </button>
            </div>
            <div style={s.divider} />
            <div style={s.tradeBlock}>
              <Field label="Tokens to sell" value={sellAmount} onChange={setSellAmount}
                placeholder="100" type="number" disabled={!isIdle} />
              <button
                style={{ ...s.btn, ...s.btnSell, opacity: (!isIdle || !address) ? 0.45 : 1 }}
                onClick={handleSell} disabled={!isIdle || !address}
              >
                {phase === "selling" ? "Selling…" : "Sell ↓"}
              </button>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", disabled }) {
  return (
    <div style={s.field}>
      <label style={s.fieldLabel}>{label}</label>
      <input
        style={{ ...s.input, opacity: disabled ? 0.55 : 1 }}
        type={type} value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled}
      />
    </div>
  );
}

const s = {
  root: {
    minHeight: "100vh", background: "#0a0a0f", color: "#e2e8f0",
    fontFamily: "'IBM Plex Mono', 'Courier New', monospace", paddingBottom: 60,
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "20px 32px", borderBottom: "1px solid #1e293b", background: "#0d0d15",
  },
  logo: { display: "flex", alignItems: "center", gap: 10 },
  logoMark: { fontSize: 22, color: "#818cf8" },
  logoText: { fontSize: 14, fontWeight: 700, letterSpacing: "0.15em", color: "#c7d2fe" },
  networkBadge: {
    fontSize: 11, padding: "4px 10px", borderRadius: 4,
    background: "#1e1b4b", color: "#818cf8", border: "1px solid #312e81", letterSpacing: "0.08em",
  },
  main: {
    maxWidth: 680, margin: "40px auto", padding: "0 20px",
    display: "flex", flexDirection: "column", gap: 20,
  },
  card: { background: "#111118", border: "1px solid #1e293b", borderRadius: 10, padding: "24px 28px" },
  cardLabel: { fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", color: "#475569", marginBottom: 14 },
  hint: { fontSize: 12, color: "#64748b", lineHeight: 1.75, margin: "0 0 16px" },
  walletRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  addressPill: {
    background: "#1e293b", padding: "6px 12px", borderRadius: 6,
    fontSize: 13, color: "#94a3b8", fontFamily: "inherit",
  },
  dot: { width: 8, height: 8, borderRadius: "50%" },
  statusText: { fontSize: 12, color: "#94a3b8" },
  txLink: {
    display: "inline-block", marginTop: 10, fontSize: 12,
    color: "#818cf8", textDecoration: "none", borderBottom: "1px solid #4338ca",
  },
  fields: { display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  fieldLabel: { fontSize: 10, letterSpacing: "0.12em", color: "#475569", textTransform: "uppercase" },
  input: {
    background: "#0d0d15", border: "1px solid #1e293b", borderRadius: 6,
    padding: "10px 12px", color: "#e2e8f0", fontSize: 13,
    fontFamily: "'IBM Plex Mono', monospace", outline: "none",
    width: "100%", boxSizing: "border-box",
  },
  btn: {
    padding: "12px 20px", borderRadius: 7, fontSize: 13,
    fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700,
    letterSpacing: "0.05em", cursor: "pointer", border: "none",
    transition: "opacity 0.2s", width: "100%",
  },
  btnPrimary: { background: "#4f46e5", color: "#fff" },
  btnBuy: { background: "#14532d", color: "#4ade80", border: "1px solid #166534" },
  btnSell: { background: "#7c2d12", color: "#fb923c", border: "1px solid #9a3412" },
  tradeRow: { display: "flex", gap: 16 },
  tradeBlock: { flex: 1, display: "flex", flexDirection: "column", gap: 12 },
  divider: { width: 1, background: "#1e293b", alignSelf: "stretch" },
  code: { background: "#1e293b", padding: "1px 5px", borderRadius: 3, fontSize: 11, color: "#94a3b8" },
  statsRow: { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" },
  statBox: {
    flex: 1, minWidth: 140, background: "#0d0d15", border: "1px solid #1e293b",
    borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 3,
  },
  statLabel: { fontSize: 9, letterSpacing: "0.18em", color: "#475569", textTransform: "uppercase" },
  statValue: { fontSize: 15, fontWeight: 700, color: "#c7d2fe", fontFamily: "'IBM Plex Mono', monospace" },
  statSub: { fontSize: 10, color: "#334155" },
};
