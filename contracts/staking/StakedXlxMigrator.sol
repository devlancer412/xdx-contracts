// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IRewardTracker.sol";

import "../access/Governable.sol";

// provide a way to migrate staked XLX tokens by unstaking from the sender
// and staking for the receiver
// meant for a one-time use for a specified sender
// requires the contract to be added as a handler for stakedXlxTracker and feeXlxTracker
contract StakedXlxMigrator is Governable {
  using SafeMath for uint256;

  address public sender;
  address public xlx;
  address public stakedXlxTracker;
  address public feeXlxTracker;
  bool public isEnabled = true;

  constructor(
    address _sender,
    address _xlx,
    address _stakedXlxTracker,
    address _feeXlxTracker
  ) public {
    sender = _sender;
    xlx = _xlx;
    stakedXlxTracker = _stakedXlxTracker;
    feeXlxTracker = _feeXlxTracker;
  }

  function disable() external onlyGov {
    isEnabled = false;
  }

  function transfer(address _recipient, uint256 _amount) external onlyGov {
    _transfer(sender, _recipient, _amount);
  }

  function _transfer(
    address _sender,
    address _recipient,
    uint256 _amount
  ) private {
    require(isEnabled, "StakedXlxMigrator: not enabled");
    require(_sender != address(0), "StakedXlxMigrator: transfer from the zero address");
    require(_recipient != address(0), "StakedXlxMigrator: transfer to the zero address");

    IRewardTracker(stakedXlxTracker).unstakeForAccount(_sender, feeXlxTracker, _amount, _sender);
    IRewardTracker(feeXlxTracker).unstakeForAccount(_sender, xlx, _amount, _sender);

    IRewardTracker(feeXlxTracker).stakeForAccount(_sender, _recipient, xlx, _amount);
    IRewardTracker(stakedXlxTracker).stakeForAccount(
      _recipient,
      _recipient,
      feeXlxTracker,
      _amount
    );
  }
}
