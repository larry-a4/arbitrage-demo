// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

// Import this file to use console.log
import "hardhat/console.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./FullMath.sol";
import "@uniswap/lib/contracts/libraries/Babylonian.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/swap-router-contracts/contracts/interfaces/ISwapRouter02.sol";

contract Arbitrager {
    using SafeMath for uint256;
    address immutable sFactory;
    ISwapRouter02 immutable uRouter;

    constructor(address _sFactory, address _uRouter) public {
        sFactory = _sFactory;
        uRouter = ISwapRouter02(_uRouter);
    }

    // computes the direction and magnitude of the profit-maximizing trade
    function computeProfitMaximizingTrade(
        uint256 truePriceTokenA,
        uint256 truePriceTokenB,
        uint256 reserveA,
        uint256 reserveB
    ) public pure returns (bool aToB, uint256 amountIn) {
        aToB =
            FullMath.mulDiv(reserveA, truePriceTokenB, reserveB) <
            truePriceTokenA;

        uint256 invariant = reserveA.mul(reserveB);

        // reserveA * reserveB * 1000 * truePriceTokenA / (truePriceTokenB * 997)
        //
        uint256 leftSide = Babylonian.sqrt(
            FullMath.mulDiv(
                invariant.mul(1000),
                aToB ? truePriceTokenA : truePriceTokenB,
                (aToB ? truePriceTokenB : truePriceTokenA).mul(997)
            )
        );
        // reserveA * 1000 / 997
        uint256 rightSide = (aToB ? reserveA.mul(1000) : reserveB.mul(1000)) /
            997;

        if (leftSide < rightSide) return (false, 0);

        // compute the amount that must be sent to move the price to the profit-maximizing price
        amountIn = leftSide.sub(rightSide);
    }

    function uniswapV2Call(
        address _sender,
        uint _amount0,
        uint _amount1,
        bytes calldata _data
    ) external {
        address[] memory path = new address[](2);
        (uint amountRequired, uint deadline) = abi.decode(_data, (uint, uint));
        if (_amount0 == 0) {
            uint amountEntryToken = _amount1;
            address token0 = IUniswapV3Pool(msg.sender).token0();
            address token1 = IUniswapV3Pool(msg.sender).token1();
            IERC20 entryToken = IERC20(token1);
            IERC20 exitToken = IERC20(token0);
            entryToken.approve(address(uRouter), amountEntryToken);
            path[0] = token1;
            path[1] = token0;
            uint amountReceived = uRouter.swapExactTokensForTokens(
                amountEntryToken,
                0,
                path,
                address(this),
                deadline
            )[1];
            exitToken.transfer(msg.sender, amountRequired);
            exitToken.transfer(_sender, amountReceived - amountRequired);
        } else {
            uint amountEntryToken = _amount0;
            address token0 = IUniswapV2Pair(msg.sender).token0();
            address token1 = IUniswapV2Pair(msg.sender).token1();
            IERC20 entryToken = IERC20(token0);
            IERC20 exitToken = IERC20(token1);
            entryToken.approve(address(uRouter), amountEntryToken);
            path[0] = token0;
            path[1] = token1;
            uint amountReceived = uRouter.swapExactTokensForTokens(
                amountEntryToken,
                0,
                path,
                address(this),
                deadline
            )[1];
            exitToken.transfer(msg.sender, amountRequired);
            exitToken.transfer(_sender, amountReceived - amountRequired);
        }
    }
}
