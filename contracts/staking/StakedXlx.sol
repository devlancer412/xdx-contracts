// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

import "../core/interfaces/IXlxManager.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IRewardTracker.sol";

// provide a way to transfer staked XLX tokens by unstaking from the sender
// and staking for the receiver
// tests in RewardRouterV2.js
contract StakedXlx {
  using SafeMath for uint256;

  string public constant name = "StakedXlx";
  string public constant symbol = "sXLX";
  uint8 public constant decimals = 18;

  address public xlx;
  IXlxManager public xlxManager;
  address public stakedXlxTracker;
  address public feeXlxTracker;

  mapping(address => mapping(address => uint256)) public allowances;

  event Approval(address indexed owner, address indexed spender, uint256 value);

  constructor(
    address _xlx,
    IXlxManager _xlxManager,
    address _stakedXlxTracker,
    address _feeXlxTracker
  ) public {
    xlx = _xlx;
    xlxManager = _xlxManager;
    stakedXlxTracker = _stakedXlxTracker;
    feeXlxTracker = _feeXlxTracker;
  }

  function allowance(address _owner, address _spender) external view returns (uint256) {
    return allowances[_owner][_spender];
  }

  function approve(address _spender, uint256 _amount) external returns (bool) {
    _approve(msg.sender, _spender, _amount);
    return true;
  }

  function transfer(address _recipient, uint256 _amount) external returns (bool) {
    _transfer(msg.sender, _recipient, _amount);
    return true;
  }

  function transferFrom(
    address _sender,
    address _recipient,
    uint256 _amount
  ) external returns (bool) {
    uint256 nextAllowance = allowances[_sender][msg.sender].sub(
      _amount,
      "StakedXlx: transfer amount exceeds allowance"
    );
    _approve(_sender, msg.sender, nextAllowance);
    _transfer(_sender, _recipient, _amount);
    return true;
  }

  function balanceOf(address _account) external view returns (uint256) {
    return IRewardTracker(feeXlxTracker).depositBalances(_account, xlx);
  }

  function totalSupply() external view returns (uint256) {
    return IERC20(stakedXlxTracker).totalSupply();
  }

  function _approve(
    address _owner,
    address _spender,
    uint256 _amount
  ) private {
    require(_owner != address(0), "StakedXlx: approve from the zero address");
    require(_spender != address(0), "StakedXlx: approve to the zero address");

    allowances[_owner][_spender] = _amount;

    emit Approval(_owner, _spender, _amount);
  }

  function _transfer(
    address _sender,
    address _recipient,
    uint256 _amount
  ) private {
    require(_sender != address(0), "StakedXlx: transfer from the zero address");
    require(_recipient != address(0), "StakedXlx: transfer to the zero address");

    require(
      xlxManager.lastAddedAt(_sender).add(xlxManager.cooldownDuration()) <= block.timestamp,
      "StakedXlx: cooldown duration not yet passed"
    );

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
