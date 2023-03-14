// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

interface IUniswapV3Pool {
    function flash(
        address recipient,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external;
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);
}

contract CyclicArbitrage {
    address private immutable owner;
    address private flashPool;

    error InvalidBalance(uint256 balanceBefore, uint256 balanceAfter);
    error CallFailed(bytes returnData);

    constructor() {
        owner = msg.sender;
    }

    struct FlashAction {
        address to;
        bytes data;
    }

    function uniswapV3Flash(
        address pool,
        address outputToken,
        uint256 minOutput,
        address recipient,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external payable returns (uint256) {
        if (msg.sender != owner) revert();

        uint256 balanceBefore = IERC20(outputToken).balanceOf(address(this));

        flashPool = pool;
        IUniswapV3Pool(pool).flash(recipient, amount0, amount1, data);
        flashPool = address(0);

        uint256 balanceAfter = IERC20(outputToken).balanceOf(address(this));
        if (balanceAfter < balanceBefore + minOutput)
            revert InvalidBalance(balanceBefore, balanceAfter);

        if (msg.value > 0) block.coinbase.transfer(msg.value);

        return balanceAfter - balanceBefore;
    }

    function uniswapV3FlashCallback(
        uint256,
        uint256,
        bytes calldata data
    ) external {
        if (msg.sender != flashPool) revert();

        FlashAction[] memory actions = abi.decode(data, (FlashAction[]));
        uint256 actionsLength = actions.length;

        for (uint256 i = 0; i < actionsLength; i++) {
            FlashAction memory action = actions[i];

            (bool success, bytes memory returnData) = action.to.call(data);
            if (!success) revert CallFailed(returnData);
        }
    }

    function withdraw(address token, uint256 amount) external {
        if (msg.sender != owner) revert();

        IERC20(token).transfer(msg.sender, amount);
    }

    function depositETH() external payable {}

    function withdrawETH(uint256 amount) external {
        if (msg.sender != owner) revert();

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert();
    }
}
