const hre = require("hardhat");

async function main() {
  const token = process.env.STOCK_TOKEN;
  const aprBps = Number(process.env.APR_BPS || "500"); // 500 = 5.00%
  if (!token) throw new Error("Set STOCK_TOKEN to the official Robinhood Stock Token contract address.");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying from:", deployer.address);
  console.log("Stock Token:", token);
  console.log("APR:", `${aprBps / 100}%`);

  const Vault = await hre.ethers.getContractFactory("StakeStreetVault");
  const vault = await Vault.deploy(token, aprBps, deployer.address);
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  console.log("StakeStreetVault deployed:", address);
  console.log("Next: approve this vault for reward tokens, call fundRewards(), then add its address to Vercel env vars.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
