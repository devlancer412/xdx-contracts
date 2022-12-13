// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../tokens/MintableBaseToken.sol";

contract XLX is MintableBaseToken {
    constructor() public MintableBaseToken("XDX LP", "XLX", 0) {
    }

    function id() external pure returns (string memory _name) {
        return "XLX";
    }
}
