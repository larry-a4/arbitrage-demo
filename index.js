const hre = require("hardhat");
const ethers = hre.ethers;
require('dotenv').config();
const uniswapSdk = require("@uniswap/v3-sdk");
const uniswapSdkCore = require("@uniswap/sdk-core");
const Web3 = require("web3");

const web3 = new Web3(ethers.provider);

// const provider = new ethers.providers.EtherscanProvider("homestead", "DBHE7MTV2MVTIVJQ13HR412K1N691PNC6P");
// ethers.provider = provider;

const privateKey = "";
const priceToken0 = process.env.PRICE_TOKEN0
const priceToken1 = process.env.PRICE_TOKEN1
const validPeriod = process.env.VALID_PERIOD

const arbitragerAbi = require("./artifacts/contracts/Arbitrager.sol/Arbitrager.json").abi;
const arbitragerContract = new ethers.Contract(
    "0x0a17FabeA4633ce714F1Fa4a2dcA62C3bAc4758d",
    arbitragerAbi,
    ethers.provider
);
// console.log(ethers.provider);

const uniswapPoolEventAbi = require("@uniswap/v3-core/artifacts/contracts/interfaces/pool/IUniswapV3PoolEvents.sol/IUniswapV3PoolEvents.json").abi;
const uniswapFactoryAbi = require("@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json").abi;
const uniswapPoolImmutablesAbi = require("@uniswap/v3-core/artifacts/contracts/interfaces/pool/IUniswapV3PoolImmutables.sol/IUniswapV3PoolImmutables.json").abi;
const uniswapRouterAbi = require("@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json").abi;

const sushiswapFactoryAbi = require("@sushiswap/core/abi/UniswapV2Factory.json");
const sushiswapPairAbi = require("@sushiswap/core/abi/IUniswapV2Pair.json");
const sushiswapRouterAbi = require("@sushiswap/core/abi/IUniswapV2Router01.json");
const { nearestUsableTick, Tick, TickMath } = require("@uniswap/v3-sdk");

const erc20Abi = require("@openzeppelin/contracts/build/contracts/ERC20.json").abi;

const uniswapFactoryAddress = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const uniswapRouterAddress = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
// https://dev.sushi.com/docs/Developers/Deployment%20Addresses
const sushiswapFactoryAddress = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac";
const sushiswapRouterAddress = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

// https://info.uniswap.org/pair/0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc
// 需要监测的Uniswap的Pool
// const uniswapPoolAddress = "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36";
// 列表：https://sushiswap-vision.vercel.app/home
// const sushiswapPairAddress = "0x06da0fd433c1a5d7a4faa01111c044910a184553";

const sushiswapFactoryContract = new ethers.Contract(
    sushiswapFactoryAddress,
    sushiswapFactoryAbi,
    ethers.provider
);
const sushiswapRouterContract = new ethers.Contract(
    sushiswapRouterAddress,
    sushiswapRouterAbi,
    ethers.provider
);
const uniswapFactoryContract = new ethers.Contract(
    uniswapFactoryAddress,
    uniswapFactoryAbi,
    ethers.provider
);
const uniswapRouterConstract = new ethers.Contract(
    uniswapRouterAddress,
    uniswapRouterAbi,
    ethers.provider
);

let myAccount;

// 从交换的参数中获取数量
function getAmountsFromSwapArgs(swapArgs) {
    const { amount0In, amount0Out, amount1In, amount1Out } = swapArgs;
    // 1. The eq method is for objects created
    //    from ethers.js BigNumber helper
    // 2. Note, this code only handles simple one-to-one token swaps.
    //    (It's also possible to swap both token0 and token1 for token0 and token1)
    let token0AmountBigDecimal = amount0In;
    if (token0AmountBigDecimal.eq(0)) {
        token0AmountBigDecimal = amount0Out;
    }

    let token1AmountBigDecimal = amount1In;
    if (token1AmountBigDecimal.eq(0)) {
        token1AmountBigDecimal = amount1Out;
    }

    return { token0AmountBigDecimal, token1AmountBigDecimal };
}

// 从最近一次交易中获取价格
function convertSwapEventToPrice({ swapArgs, token0Decimals, token1Decimals }) {
    const {
        token0AmountBigDecimal,
        token1AmountBigDecimal,
    } = getAmountsFromSwapArgs(swapArgs);

    console.log(`Sushiswap event: token0:${token0AmountBigDecimal}, token1: ${token1AmountBigDecimal}`)

    const token0AmountFloat = parseFloat(
        ethers.utils.formatUnits(token0AmountBigDecimal, token0Decimals)
    );
    const token1AmounFloat = parseFloat(
        ethers.utils.formatUnits(token1AmountBigDecimal, token1Decimals)
    );

    if (token1AmounFloat > 0) {
        const priceOfToken0InTermsOfToken1 = token0AmountFloat / token1AmounFloat;
        return { price: priceOfToken0InTermsOfToken1, volume: token0AmountFloat };
    }

    return null;
}

async function monitor(token0Address, token1Address) {
    const token0 = new ethers.Contract(
        token0Address,
        erc20Abi,
        ethers.provider
    );
    const token1 = new ethers.Contract(
        token1Address,
        erc20Abi,
        ethers.provider
    );
    let tokenName = {};
    tokenName[token0Address] = await token0.symbol();
    tokenName[token1Address] = await token1.symbol();
    let tokenDecimals = {};
    tokenDecimals[token0Address] = await token0.decimals();
    tokenDecimals[token1Address] = await token1.decimals();
    let tokenSymbol = {};
    tokenSymbol[token0Address] = await token0.symbol();
    tokenSymbol[token1Address] = await token1.symbol();
    // 在两个swap获取pair
    let uniswapPoolAddress = await uniswapFactoryContract.getPool(token0Address, token1Address, 3000); // 这里还有第三个参数, TODO
    let sushiswapPairAddress = await sushiswapFactoryContract.getPair(token0Address, token1Address);
    console.log(`Uniswap pool: ${uniswapPoolAddress}, Sushiswap pool: ${sushiswapPairAddress}`);

    // 获取必要的合约
    const sushiswapPairContract = new ethers.Contract(
        sushiswapPairAddress,
        sushiswapPairAbi,
        ethers.provider
    );
    const uniswapPoolEventContract = new ethers.Contract(
        uniswapPoolAddress,
        uniswapPoolEventAbi,
        ethers.provider
    );
    const uniswapContractImmutable = new ethers.Contract(
        uniswapPoolAddress,
        uniswapPoolImmutablesAbi,
        ethers.provider
    );

    // 保存最近一次交易的价格
    let latestUniswapPrice = null;
    let latestSushiswapPrice = null;

    let onPriceChanged = async (price, volume, fee, swapper) => {
        // let sqrtPriceX96, liquidity, tick;
        // function getAmountsOut(tokenInAddress, tokenOutAddress, decimalsIn, decimalsOut) {
        //     const tokenIn = new uniswapSdkCore.Token(ethers.provider.network.chainId, tokenInAddress, decimalsIn);
        //     const tokenOut = new uniswapSdkCore.Token(ethers.provider.network.chainId, tokenOutAddress, decimalsOut);
        //     const pool = new uniswapSdk.Pool(
        //         tokenIn,
        //         tokenOut,
        //         fee
        //     )
        // }
        // https://github.com/Uniswap/v2-periphery/blob/0335e8f7e1bd1e8d8329fd300aea2ef2f36dd19f/contracts/libraries/UniswapV2Library.sol#L43
        function getAmountOut(amountIn, reserveIn, reserveOut) {
            if (amountIn <= 0) {
                throw Error();
            }
            if (reserveIn <= 0 || reserveOut <= 0) {
                throw Error();
            }
            amountsInWithFee = amountIn * 997;
            numerator = amountsInWithFee * reserveOut;
            denominator = reserveIn * 1000 + amountsInWithFee;
            return numerator / denominator;
        }

        if (swapper === "uniswap") {
            latestUniswapPrice = price;
        } else if (swapper === "sushiswap") {
            latestSushiswapPrice = price;
        }
        console.log(`Sushi price: ${latestSushiswapPrice}(${tokenName[token0Address]}/${tokenName[token1Address]}), Uniswap price: ${latestUniswapPrice} ${tokenName[token0Address]}/${tokenName[token1Address]}`);

        if (latestSushiswapPrice != null && latestUniswapPrice != null) {
            let wantedProfit = 0.001;
            // 价格差（token0 per token1）
            // let price = Math.abs(latestSushiswapPrice - latestUniswapPrice);

            let gasPrice = await ethers.provider.getGasPrice();
            console.log(`GasPrice: ${gasPrice}`);

            let uReserve0 = await token0.balanceOf(uniswapContractImmutable.address);
            let uReserve1 = await token1.balanceOf(uniswapContractImmutable.address);
            const priceEth = (uReserve0 / uReserve1);

            const priceToken0Eth = priceToken0 * 1 / priceEth
            const priceToken1Eth = priceToken1 * 1 / priceEth

            let sReserves = await sushiswapPairContract.getReserves();
            let sReserve0 = sReserves[0];
            let sReserve1 = sReserves[1];

            const result = await arbitragerContract.computeProfitMaximizingTrade(sReserve0, sReserve1, uReserve0, uReserve1);
            console.log(`computeProfitMaximizingTrade result: ${result}`);
            const aToB = result[0] //trade direction
            const amountIn = result[1]

            if (amountIn == 0) { console.log(`No arbitrage opportunity on block\n`); return }

            if (aToB) {
                //amount of T1 received for swapping the precomputed amount of T0 on uniswap
                const amountOut = getAmountOut(amountIn, uReserve0, uReserve1)

                //new reserves after trade
                const newUReserve0 = Number(uReserve0) + Number(amountIn)
                const newUReserve1 = Number(uReserve1) - Number(amountOut)

                //amount nedeed for repaying flashswap taken on sushiswap, used below
                const sAmountIn = await sushiswapRouterContract.getAmountIn(amountIn, sReserve1, sReserve0)

                //sushiswap price
                const sPrice = 1 / (sAmountIn / amountIn)//trade price

                //difference per T0 traded
                const difference = amountOut / amountIn - 1 / sPrice

                if (difference <= 0) { console.log(`No arbitrage opportunity on block\n`); return }

                //total difference (difference*quantity traded)
                const totalDifference = difference * Math.round(amountIn / 10 ** 18)

                //time during the swap can be executed, after that it will be refused by uniswap
                const deadline = Math.round(Date.now() / 1000) + validPeriod * 60

                //gas
                const gasNeeded = (0.3 * 10 ** 6) * 2 //previosly measured (line below), take to much time, overestimate 2x
                //const gasNeeded = await sPair.methods.swap(amountIn,0,addrArbitrager,abi).estimateGas()

                const gasPrice = await web3.eth.getGasPrice()
                const gasCost = Number(gasPrice) * gasNeeded / 10 ** 18

                //profitable?
                const profit = (totalDifference * priceToken1Eth) - gasCost

                console.log(
                    `Block`.bgBlue + `\n\n` +
                    `${tokenName[token0Address]} (${tokenSymbol[token0Address]}) {T0} | ${tokenName[token1Address]} (${tokenSymbol[token0Address]}) {T1} reserves\n\n` +
                    `On Uniswap\n` +
                    `${tokenSymbol[token0Address]}: ${Math.round(uReserve0 / 10 ** 18)} | ${tokenSymbol[token1Address]}: ${Math.round(uReserve1 / 10 ** 18)}\n\n` +
                    `On Sushiswap\n` +
                    `${tokenSymbol[token0Address]}: ${Math.round(sReserve0 / 10 ** 18)} | ${tokenSymbol[token1Address]}: ${Math.round(sReserve1 / 10 ** 18)}\n\n` +
                    `Swap's direction\n` +
                    `${tokenSymbol[token0Address]} -> ${tokenSymbol[token1Address]}\n\n` +
                    `Uniswap's pool state\n` +
                    `${tokenSymbol[token1Address]} excess/${tokenSymbol[token0Address]} shortage\n\n` +
                    `On Uniswap\n` +
                    `Mid price before swap: ${(uReserve0 / uReserve1).toFixed(2)} ${tokenSymbol[token0Address]}/${tokenSymbol[token1Address]}\n` +
                    `Mid price after swap: ${(newUReserve0 / newUReserve1).toFixed(2)} ${tokenSymbol[token0Address]}/${tokenSymbol[token1Address]}\n` +
                    `Swap ${Math.round(amountIn / 10 ** 18)} ${tokenSymbol[token0Address]} for ${Math.round(amountOut / 10 ** 18)} ${tokenSymbol[token1Address]}\n` +
                    `Trade price: ${(1 / (amountOut / amountIn)).toFixed(2)} ${tokenSymbol[token0Address]}/${tokenSymbol[token1Address]} (buy price)\n\n` +
                    `Sushiswap price: ${(sPrice).toFixed(2)} ${tokenSymbol[token0Address]}/${tokenSymbol[token1Address]} (sell price)\n` +
                    `Difference: ${(difference).toFixed(2)} ${tokenSymbol[token1Address]}/${tokenSymbol[token0Address]}\n` +
                    `Total difference: ${(totalDifference * priceToken1Eth).toFixed(5)} ETH or ${totalDifference.toFixed(2)} ${tokenSymbol[token1Address]}\n\n` +
                    `Gas needed: ${gasNeeded / 10 ** 6}\n` +
                    `Gas price: ${gasPrice / 10 ** 9} gwei\n` +
                    `Gas cost: ${gasCost.toFixed(5)} ETH\n\n` +
                    `${profit > 0 ? `Profit: ${profit.toFixed(5)} ETH or ${(profit * priceEth).toFixed(2)} DAI\n`.green :
                        `No profit! (gas cost higher than the total difference achievable)\n`.red}`
                )

                if (profit <= 0) return;

                const abi = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [sAmountIn, deadline])

                const tx = { //transaction
                    from: myAccount,
                    to: sushiswapPairContract.options.address,
                    gas: gasNeeded,
                    data: sushiswapPairContract.swap(amountIn, 0, addrArbitrager, abi).encodeABI()
                }

                let signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);

                console.log('Tx pending')
                let receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction)

                console.log(
                    `Tx mined, trade executed!\n` +
                    `Tx hash: ${receipt.transactionHash}\n`
                )
            } else {//T1->T0

                const amountOut = getAmountOut(amountIn, uReserve1, uReserve0).call()
                const newUReverve0 = Number(uReserve0) - Number(amountOut)
                const newUReverve1 = Number(uReserve1) + Number(amountIn)
                const sAmountIn = await sushiswapRouterContract.getAmountIn(amountIn, sReserve0, sReserve1)
                const sPrice = sAmountIn / amountIn
                const difference = amountOut / amountIn - sPrice

                if (difference <= 0) { console.log(`No arbitrage opportunity on block\n`); return }

                const totalDifference = difference * Math.round(amountIn / 10 ** 18)
                const deadline = Math.round(Date.now() / 1000) + validPeriod * 60
                const gasNeeded = (0.3 * 10 ** 6) * 2
                const gasPrice = await web3.eth.getGasPrice()
                const gasCost = Number(gasPrice) * gasNeeded / 10 ** 18
                const profit = (totalDifference * priceToken0Eth) - gasCost

                console.log(
                    `Block`.bgBlue + `\n\n` +
                    `${token0Name} (${tokenSymbol[token0Address]}) {T0} | ${token1Name} (${tokenSymbol[token1Address]}) {T1} reserves\n\n` +
                    `On Uniswap\n` +
                    `${tokenSymbol[token0Address]}: ${Math.round(uReserve0 / 10 ** 18)} | ${tokenSymbol[token1Address]}: ${Math.round(uReserve1 / 10 ** 18)}\n\n` +
                    `On Sushiswap\n` +
                    `${tokenSymbol[token0Address]}: ${Math.round(sReserve0 / 10 ** 18)} | ${tokenSymbol[token1Address]}: ${Math.round(sReserve1 / 10 ** 18)}\n\n` +
                    `Swap's direction\n` +
                    `${tokenSymbol[token1Address]} -> ${tokenSymbol[token0Address]}\n\n` +
                    `Uniswap's pool state\n` +
                    `${tokenSymbol[token0Address]} excess/${tokenSymbol[token1Address]} shortage\n\n` +
                    `On Uniswap\n` +
                    `Mid price before swap: ${(uReserve0 / uReserve1).toFixed(2)} ${tokenSymbol[token0Address]}/${tokenSymbol[token1Address]}\n` +
                    `Mid price after swap: ${(newUReverve0 / newUReverve1).toFixed(2)} ${tokenSymbol[token0Address]}/${tokenSymbol[token1Address]}\n` +
                    `Swap ${Math.round(amountIn / 10 ** 18)} ${tokenSymbol[token1Address]} for ${Math.round(amountOut / 10 ** 18)} ${tokenSymbol[token0Address]}\n` +
                    `Trade price: ${(amountOut / amountIn).toFixed(2)} ${tokenSymbol[token0Address]}/${tokenSymbol[token1Address]} (sell price)\n\n` +
                    `Sushiswap price: ${sPrice.toFixed(2)} ${tokenSymbol[token0Address]}/${tokenSymbol[token1Address]} (buy price)\n` +
                    `Difference: ${(difference).toFixed(2)} ${tokenSymbol[token0Address]}/${tokenSymbol[token1Address]}\n` +
                    `Total difference: ${(totalDifference * priceToken0Eth).toFixed(5)} ETH or ${totalDifference.toFixed(2)} ${tokenSymbol[token0Address]}\n\n` +
                    `Gas needed: ${gasNeeded / 10 ** 6} M\n` +
                    `Gas price: ${gasPrice / 10 ** 9} gwei\n` +
                    `Gas cost: ${gasCost.toFixed(5)} ETH\n\n` +
                    `${profit > 0 ? `Profit: ${profit.toFixed(5)} ETH or ${(profit * priceEth).toFixed(2)} DAI\n`.green :
                        `No profit! (gas cost higher than the total difference achievable)\n`.red}`
                )

                if (profit <= 0) return;

                const abi = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [sAmountIn, deadline])
                const tx = {
                    from: myAccount,
                    to: sPair.options.address,
                    gas: gasNeeded,
                    data: sPair.methods.swap(0, amountIn, addrArbitrager, abi).encodeABI()
                }
                let signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
                console.log('Tx pending')
                let receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction)
                console.log(
                    'Tx mined, trade executed!\n' +
                    `Tx hash: ${receipt.transactionHash}\n`
                )

            }
        }
    }

    const sushiswapFilter = sushiswapPairContract.filters.Swap();
    const uniswapFilter = uniswapPoolEventContract.filters.Swap();

    const uniswapFee = await uniswapContractImmutable.fee();
    const uniswapToken0 = await uniswapContractImmutable.token0();
    const uniswapToken1 = await uniswapContractImmutable.token1();
    const sushiswapToken0 = await sushiswapPairContract.token0();
    const sushiswapToken1 = await sushiswapPairContract.token1();

    console.log('\x1b[33m%s\x1b[0m', `Uniswap Fee: ${uniswapFee}
Uniswap Tokens: ${uniswapToken0}, ${uniswapToken1}
Sushiswap Tokens: ${sushiswapToken0}, ${sushiswapToken1}`);

    sushiswapPairContract.on(sushiswapFilter, (_from, _a0in, _a0out, _a1in, _a1out, _to, event) => {
        // console.debug("Sushiswap event: ", event)
        const { price, volume } = convertSwapEventToPrice({
            swapArgs: event.args,
            // the USDC ERC20 uses 6 decimals
            token0Decimals: tokenDecimals[token0Address],
            // the WETH ERC20 uses 18 decimals
            token1Decimals: tokenDecimals[token1Address],
        });
        onPriceChanged(price, volume, uniswapFee, "sushiswap");
    });
    // 在uniswap上监控价格变化
    uniswapPoolEventContract.on(uniswapFilter, (_from, _recipient, amount0, amount1, _sqrtPriceX96, liquidity, _tick, event) => {
        // console.debug("Uniswap event: ", event)

        // TODO 获取两种Token的Decimal
        let floatToken0 = ethers.utils.formatUnits(event.args.amount0, tokenDecimals[token0Address]);
        let floatToken1 = ethers.utils.formatUnits(event.args.amount1, tokenDecimals[token1Address]);
        console.log(`uniswap event: amount0: ${amount0}(${floatToken0})${tokenName[token0Address]}, amount1: ${amount1}(${floatToken1})${tokenName[token1Address]},liquidity`)

        onPriceChanged(Math.abs(floatToken0 / floatToken1), floatToken0, uniswapFee, "uniswap");
    });
};

(async () => {
    myAccount = await web3
    monitor(
        "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
