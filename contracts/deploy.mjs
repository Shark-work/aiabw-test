/**
 * AibiSoulCard · Sepolia 部署脚本（平台升级 Phase 2，2026-09-30）
 * ----------------------------------------------------------------
 * 零 hardhat 轻量方案：solc 本地编译（@openzeppelin 从本目录 node_modules
 * 直读解析）+ viem 直接发送部署交易。
 *
 * 用法（在本 contracts/ 目录下）：
 *   npm install
 *   node --env-file=../.env.local deploy.mjs      # 推荐：密钥放根目录 .env.local
 *   :: 或临时传入：set CHAIN_DEPLOYER_KEY=0x... && node deploy.mjs
 *   npm run compile                                # 仅编译验证，不部署
 *
 * 环境变量：
 *   CHAIN_DEPLOYER_KEY       必需。部署者私钥（0x+64hex），钱包需有 Sepolia ETH；
 *                            该地址自动获得 DEFAULT_ADMIN_ROLE + MINTER_ROLE（平台热钱包）
 *   CHAIN_RPC_URL            可选。Sepolia RPC，缺省公共节点 ethereum-sepolia-rpc.publicnode.com
 *   CHAIN_MAX_SUPPLY         可选。发行硬顶，缺省 100000（与 chain_supply.max_supply 对齐）
 *   CHAIN_METADATA_BASE_URI  可选。tokenURI 前缀，缺省 https://aiabw.com/api/chain/metadata/
 *
 * ⚠️ 安全红线：私钥绝不写入本文件 / 仓库 / NEXT_PUBLIC_*；仅经环境变量传入。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const COMPILE_ONLY = process.argv.includes("--compile-only");

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

// ---------- 0) 环境检查 ----------
const rpcUrl = (
  process.env.CHAIN_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
).trim();
const rawKey = (process.env.CHAIN_DEPLOYER_KEY ?? "").trim();
if (!COMPILE_ONLY && !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
  fail(
    "缺少 CHAIN_DEPLOYER_KEY（0x 前缀 64 位 hex）。\n" +
      "  推荐：写入根目录 .env.local 后执行 node --env-file=../.env.local deploy.mjs",
  );
}
const maxSupply = BigInt(
  Math.max(1, Math.trunc(Number(process.env.CHAIN_MAX_SUPPLY ?? 100000))),
);
const baseURI = (
  process.env.CHAIN_METADATA_BASE_URI ?? "https://aiabw.com/api/chain/metadata/"
).trim();
if (!baseURI.endsWith("/")) {
  fail("CHAIN_METADATA_BASE_URI 必须以 / 结尾（tokenURI = baseURI + tokenId）");
}

// ---------- 1) solc 编译 ----------
console.log("⚙️  编译 AibiSoulCard.sol（solc + @openzeppelin/contracts）…");
function findImports(importPath) {
  // OZ 依赖从本目录 node_modules 直读（包无 exports 限制，.sol 纯文件）
  const candidates = [
    join(HERE, "node_modules", importPath),
    join(HERE, importPath),
  ];
  for (const p of candidates) {
    try {
      return { contents: readFileSync(p, "utf8") };
    } catch {
      /* try next candidate */
    }
  }
  return { error: `File not found: ${importPath}` };
}
const source = readFileSync(join(HERE, "AibiSoulCard.sol"), "utf8");
const compiled = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: { "AibiSoulCard.sol": { content: source } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        outputSelection: {
          "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] },
        },
      },
    }),
    { import: findImports },
  ),
);
const fatal = (compiled.errors ?? []).filter((e) => e.severity === "error");
if (fatal.length > 0) {
  for (const e of fatal) console.error(e.formattedMessage ?? e.message);
  fail("编译失败");
}
for (const w of (compiled.errors ?? []).filter((e) => e.severity === "warning")) {
  console.warn(`⚠️  ${w.formattedMessage ?? w.message}`);
}
const artifact = compiled.contracts?.["AibiSoulCard.sol"]?.AibiSoulCard;
if (!artifact?.evm?.bytecode?.object) fail("编译产物缺失（AibiSoulCard）");
const abi = artifact.abi;
const bytecode = `0x${artifact.evm.bytecode.object}`;
const deployedSize = artifact.evm.deployedBytecode.object.length / 2;
mkdirSync(join(HERE, "artifacts"), { recursive: true });
writeFileSync(
  join(HERE, "artifacts", "AibiSoulCard.json"),
  JSON.stringify({ contractName: "AibiSoulCard", abi, bytecode }, null, 2),
);
console.log(
  `✔ 编译成功：runtime ${deployedSize} bytes（EIP-170 上限 24576）→ artifacts/AibiSoulCard.json`,
);
if (deployedSize > 24576) fail("合约体积超过 EIP-170 上限，需开 viaIR 或瘦身");
if (COMPILE_ONLY) {
  console.log("（--compile-only）编译验证通过，未部署。");
  process.exit(0);
}

// ---------- 2) 部署 ----------
const account = privateKeyToAccount(rawKey);
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });

const balance = await publicClient.getBalance({ address: account.address });
console.log(`👛 部署钱包 ${account.address}（余额 ${formatEther(balance)} ETH）`);
if (balance === 0n) {
  fail(
    "余额为 0，请先领取 Sepolia 测试币：\n" +
      "  · https://cloud.google.com/application/web3/faucet/ethereum/sepolia\n" +
      "  · https://www.alchemy.com/faucets/ethereum-sepolia\n" +
      "  · https://sepolia-faucet.pk910.de/（PoW 挖矿，无需注册）",
  );
}

console.log(`🚀 部署中… MAX_SUPPLY=${maxSupply} baseURI=${baseURI}`);
const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [maxSupply, baseURI],
});
console.log(`⏳ 交易已提交 ${hash}\n   https://sepolia.etherscan.io/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({
  hash,
  confirmations: 1,
});
if (receipt.status !== "success" || !receipt.contractAddress) {
  fail(`部署交易失败: ${hash}`);
}
const address = receipt.contractAddress;
console.log(
  `✔ 合约地址 ${address}（区块 ${receipt.blockNumber}，gas ${receipt.gasUsed}）\n` +
    `  https://sepolia.etherscan.io/address/${address}`,
);

// ---------- 3) 链上自检 ----------
const [onchainMax, tokenName, tokenSymbol, minterRole] = await Promise.all([
  publicClient.readContract({ address, abi, functionName: "MAX_SUPPLY" }),
  publicClient.readContract({ address, abi, functionName: "name" }),
  publicClient.readContract({ address, abi, functionName: "symbol" }),
  publicClient.readContract({ address, abi, functionName: "MINTER_ROLE" }),
]);
const hasMinter = await publicClient.readContract({
  address,
  abi,
  functionName: "hasRole",
  args: [minterRole, account.address],
});
console.log(
  `🔎 自检: name=${tokenName} symbol=${tokenSymbol} MAX_SUPPLY=${onchainMax} 部署者持 MINTER_ROLE=${hasMinter}`,
);
if (onchainMax !== maxSupply || !hasMinter) fail("链上自检未通过");

// ---------- 4) 下一步配置 ----------
console.log(`
──────── 部署完成：把以下写入根目录 .env.local 与 Vercel 环境变量 ────────
CHAIN_PROVIDER=evm
CHAIN_NETWORK=sepolia
CHAIN_RPC_URL=${rpcUrl}
CHAIN_CONTRACT_ADDRESS=${address}
CHAIN_CUSTODY_ADDRESS=${account.address}
CHAIN_DEPLOYER_KEY=<保持现状，勿外泄>

并把 src/server/chain/chain-config.ts 的 CHAIN_CONTRACT_ADDRESS 默认值
更新为 ${address}（公开信息，可入库；私钥除外）。
`);

