import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Polygon PoS integration (ethers v6). Talks to the AgreementRegistry contract.
 * Local dev: Hardhat node (chainId 31337) with the deployment written by blockchain/scripts/deploy.js.
 * Amoy / mainnet: set CHAIN_RPC, CHAIN_PRIVATE_KEY (registrar wallet) and CHAIN_DEPLOYMENT.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const BC = path.resolve(here, "../../../../blockchain");
const DEPLOYMENT = process.env.CHAIN_DEPLOYMENT || path.join(BC, "deployments/localhost.json");
const ARTIFACT = path.join(BC, "artifacts/contracts/AgreementRegistry.sol/AgreementRegistry.json");
// Hardhat's well-known dev account #0 — used ONLY for the local chain. Never use for a real network.
const HARDHAT_DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export const NETWORKS = {
  31337: { name: "Hardhat Local (Polygon PoS-compatible EVM)", explorer: null, testnet: true },
  80002: { name: "Polygon Amoy Testnet", explorer: "https://amoy.polygonscan.com", testnet: true },
  137: { name: "Polygon PoS Mainnet", explorer: "https://polygonscan.com", testnet: false },
};

export const agreementRef = (agreementId) => ethers.keccak256(ethers.toUtf8Bytes(agreementId));
const hex32 = (sha256hex) => "0x" + sha256hex.replace(/^0x/, "");

export function createChain() {
  const rpc = process.env.CHAIN_RPC || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: false });
  const wallet = new ethers.Wallet(process.env.CHAIN_PRIVATE_KEY || HARDHAT_DEV_KEY, provider);
  let deployment = null;
  let contract = null;

  function load() {
    if (!fs.existsSync(DEPLOYMENT)) throw new Error(`No deployment file at ${DEPLOYMENT}. Run: cd blockchain && npm run deploy:local`);
    deployment = JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8"));
    contract = new ethers.Contract(deployment.address, deployment.abi, wallet);
  }

  async function info() {
    if (!contract) load();
    const net = await provider.getNetwork();
    const chainId = Number(net.chainId);
    return { chainId, network: NETWORKS[chainId]?.name || `EVM chain ${chainId}`, explorer: NETWORKS[chainId]?.explorer || null,
      contract: deployment.address, registrar: wallet.address, block: await provider.getBlockNumber() };
  }

  /** Local chains lose state on restart: redeploy if the contract is gone (caller re-anchors records). */
  async function ensureDeployed() {
    try { load(); } catch { /* no deployment yet */ }
    const code = deployment ? await provider.getCode(deployment.address) : "0x";
    if (code !== "0x") return { redeployed: false };
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== 31337) throw new Error("Registry contract not found on this network — deploy it with the blockchain package");
    const art = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
    const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
    const c = await factory.deploy(wallet.address);
    await c.waitForDeployment();
    deployment = { network: "localhost", chainId: 31337, address: await c.getAddress(), deployer: wallet.address,
      deployedAt: new Date().toISOString(), abi: art.abi };
    fs.mkdirSync(path.dirname(DEPLOYMENT), { recursive: true });
    fs.writeFileSync(DEPLOYMENT, JSON.stringify(deployment, null, 2));
    contract = new ethers.Contract(deployment.address, deployment.abi, wallet);
    return { redeployed: true, address: deployment.address };
  }

  async function register(agreementId, docSha256, version) {
    if (!contract) load();
    const ref = agreementRef(agreementId);
    const tx = await contract.register(ref, hex32(docSha256), version);
    const receipt = await tx.wait();
    const block = await provider.getBlock(receipt.blockNumber);
    const rec = await contract.getVersion(ref, version);
    const i = await info();
    return {
      status: "registered", network: i.network, chainId: i.chainId, contract: i.contract, agreementRef: ref,
      docHash: hex32(docSha256), version, txHash: receipt.hash, blockNumber: receipt.blockNumber,
      registeredAt: new Date(Number(block.timestamp) * 1000), registrar: receipt.from, prevDocHash: rec.prevDocHash,
    };
  }

  /** Where (if anywhere) a document hash is registered. */
  async function lookup(docSha256) {
    if (!contract) load();
    const [ref, version] = await contract.lookup(hex32(docSha256));
    return Number(version) ? { agreementRef: ref, version: Number(version) } : null;
  }

  async function latest(agreementId) {
    if (!contract) load();
    const ref = agreementRef(agreementId);
    if (Number(await contract.versionCount(ref)) === 0) return null;
    const r = await contract.latest(ref);
    return { docHash: r.docHash, prevDocHash: r.prevDocHash, version: Number(r.version), registeredAt: new Date(Number(r.registeredAt) * 1000), registrar: r.registrar };
  }

  async function getVersion(agreementId, version) {
    if (!contract) load();
    const r = await contract.getVersion(agreementRef(agreementId), version);
    return { docHash: r.docHash, prevDocHash: r.prevDocHash, version: Number(r.version), registeredAt: new Date(Number(r.registeredAt) * 1000), registrar: r.registrar };
  }

  return { info, ensureDeployed, register, lookup, latest, getVersion };
}
