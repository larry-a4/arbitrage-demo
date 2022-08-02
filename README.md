1 输入需要兑换的Token的Address，通过Token的decimals()获取精度

2 通过UniswapFactory和SushiswapFactory获取两个Token在两边的Pool(Pair)

3 监听Pool的Swap事件更新脚本内的最新价格

4 在价格变动时判断是否进行交易

4.1 计算 sqrt(reserveA * reserveB * 1000 * truePriceTokenA / (truePriceTokenB * 997)) 和 reserveA * 1000 / 997

4.2 根据4.2计算的值判断是否有套利空间和兑换方向，并计算应兑换的数量

4.3 计算当前价格差和能获取的利润（扣除gas）

5 如果有利可图，调用代理合约进行交易
