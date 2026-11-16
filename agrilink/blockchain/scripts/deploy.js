// Deploys AgreementRegistry and writes deployments/<network>.json (address + ABI) for the API server.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const Registry = await hre.ethers.getContractFactory("AgreementRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  const net = await hre.ethers.provider.getNetwork();
  const artifact = await hre.artifacts.readArtifact("AgreementRegistry");
  const out = {
    network: hre.network.name, chainId: Number(net.chainId), address, deployer: deployer.address,
    deployedAt: new Date().toISOString(), deployTx: registry.deploymentTransaction()?.hash, abi: artifact.abi,
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${hre.network.name}.json`), JSON.stringify(out, null, 2));
  console.log(`AgreementRegistry deployed to ${address} on ${hre.network.name} (chainId ${out.chainId})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
