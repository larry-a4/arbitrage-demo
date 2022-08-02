const hre = require("hardhat");

const uSwapRouterAddress = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const sFactoryAddress = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac";

(async function main() {
    const Arbitrager = await hre.ethers.getContractFactory("Arbitrager");
    const arbitrager = await Arbitrager.deploy();

    await arbitrager.deployed();

    console.log(
        `deployed to ${arbitrager.address}`
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
