// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "../libraries/utils/Address.sol";

import "./interfaces/IRewardTracker.sol";
import "../tokens/interfaces/IMintable.sol";
import "../tokens/interfaces/IWETH.sol";
import "../core/interfaces/IXlxManager.sol";
import "../access/Governable.sol";

contract RewardRouter is ReentrancyGuard, Governable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;
  using Address for address payable;

  bool public isInitialized;

  address public weth;

  address public xdx;
  address public esXdx;
  address public bnXdx;

  address public xlx; // XDX Liquidity Provider token

  address public stakedXdxTracker;
  address public bonusXdxTracker;
  address public feeXdxTracker;

  address public stakedXlxTracker;
  address public feeXlxTracker;

  address public xlxManager;

  event StakeXdx(address account, uint256 amount);
  event UnstakeXdx(address account, uint256 amount);

  event StakeXlx(address account, uint256 amount);
  event UnstakeXlx(address account, uint256 amount);

  receive() external payable {
    require(msg.sender == weth, "Router: invalid sender");
  }

  function initialize(
    address _weth,
    address _xdx,
    address _esXdx,
    address _bnXdx,
    address _xlx,
    address _stakedXdxTracker,
    address _bonusXdxTracker,
    address _feeXdxTracker,
    address _feeXlxTracker,
    address _stakedXlxTracker,
    address _xlxManager
  ) external onlyGov {
    require(!isInitialized, "RewardRouter: already initialized");
    isInitialized = true;

    weth = _weth;

    xdx = _xdx;
    esXdx = _esXdx;
    bnXdx = _bnXdx;

    xlx = _xlx;

    stakedXdxTracker = _stakedXdxTracker;
    bonusXdxTracker = _bonusXdxTracker;
    feeXdxTracker = _feeXdxTracker;

    feeXlxTracker = _feeXlxTracker;
    stakedXlxTracker = _stakedXlxTracker;

    xlxManager = _xlxManager;
  }

  // to help users who accidentally send their tokens to this contract
  function withdrawToken(
    address _token,
    address _account,
    uint256 _amount
  ) external onlyGov {
    IERC20(_token).safeTransfer(_account, _amount);
  }

  function batchStakeXdxForAccount(address[] memory _accounts, uint256[] memory _amounts)
    external
    nonReentrant
    onlyGov
  {
    address _xdx = xdx;
    for (uint256 i = 0; i < _accounts.length; i++) {
      _stakeXdx(msg.sender, _accounts[i], _xdx, _amounts[i]);
    }
  }

  function stakeXdxForAccount(address _account, uint256 _amount) external nonReentrant onlyGov {
    _stakeXdx(msg.sender, _account, xdx, _amount);
  }

  function stakeXdx(uint256 _amount) external nonReentrant {
    _stakeXdx(msg.sender, msg.sender, xdx, _amount);
  }

  function stakeEsXdx(uint256 _amount) external nonReentrant {
    _stakeXdx(msg.sender, msg.sender, esXdx, _amount);
  }

  function unstakeXdx(uint256 _amount) external nonReentrant {
    _unstakeXdx(msg.sender, xdx, _amount);
  }

  function unstakeEsXdx(uint256 _amount) external nonReentrant {
    _unstakeXdx(msg.sender, esXdx, _amount);
  }

  function mintAndStakeXlx(
    address _token,
    uint256 _amount,
    uint256 _minUsdg,
    uint256 _minXlx
  ) external nonReentrant returns (uint256) {
    require(_amount > 0, "RewardRouter: invalid _amount");

    address account = msg.sender;
    uint256 xlxAmount = IXlxManager(xlxManager).addLiquidityForAccount(
      account,
      account,
      _token,
      _amount,
      _minUsdg,
      _minXlx
    );
    IRewardTracker(feeXlxTracker).stakeForAccount(account, account, xlx, xlxAmount);
    IRewardTracker(stakedXlxTracker).stakeForAccount(account, account, feeXlxTracker, xlxAmount);

    emit StakeXlx(account, xlxAmount);

    return xlxAmount;
  }

  function mintAndStakeXlxETH(uint256 _minUsdg, uint256 _minXlx)
    external
    payable
    nonReentrant
    returns (uint256)
  {
    require(msg.value > 0, "RewardRouter: invalid msg.value");

    IWETH(weth).deposit{value: msg.value}();
    IERC20(weth).approve(xlxManager, msg.value);

    address account = msg.sender;
    uint256 xlxAmount = IXlxManager(xlxManager).addLiquidityForAccount(
      address(this),
      account,
      weth,
      msg.value,
      _minUsdg,
      _minXlx
    );

    IRewardTracker(feeXlxTracker).stakeForAccount(account, account, xlx, xlxAmount);
    IRewardTracker(stakedXlxTracker).stakeForAccount(account, account, feeXlxTracker, xlxAmount);

    emit StakeXlx(account, xlxAmount);

    return xlxAmount;
  }

  function unstakeAndRedeemXlx(
    address _tokenOut,
    uint256 _xlxAmount,
    uint256 _minOut,
    address _receiver
  ) external nonReentrant returns (uint256) {
    require(_xlxAmount > 0, "RewardRouter: invalid _xlxAmount");

    address account = msg.sender;
    IRewardTracker(stakedXlxTracker).unstakeForAccount(account, feeXlxTracker, _xlxAmount, account);
    IRewardTracker(feeXlxTracker).unstakeForAccount(account, xlx, _xlxAmount, account);
    uint256 amountOut = IXlxManager(xlxManager).removeLiquidityForAccount(
      account,
      _tokenOut,
      _xlxAmount,
      _minOut,
      _receiver
    );

    emit UnstakeXlx(account, _xlxAmount);

    return amountOut;
  }

  function unstakeAndRedeemXlxETH(
    uint256 _xlxAmount,
    uint256 _minOut,
    address payable _receiver
  ) external nonReentrant returns (uint256) {
    require(_xlxAmount > 0, "RewardRouter: invalid _xlxAmount");

    address account = msg.sender;
    IRewardTracker(stakedXlxTracker).unstakeForAccount(account, feeXlxTracker, _xlxAmount, account);
    IRewardTracker(feeXlxTracker).unstakeForAccount(account, xlx, _xlxAmount, account);
    uint256 amountOut = IXlxManager(xlxManager).removeLiquidityForAccount(
      account,
      weth,
      _xlxAmount,
      _minOut,
      address(this)
    );

    IWETH(weth).withdraw(amountOut);

    _receiver.sendValue(amountOut);

    emit UnstakeXlx(account, _xlxAmount);

    return amountOut;
  }

  function claim() external nonReentrant {
    address account = msg.sender;

    IRewardTracker(feeXdxTracker).claimForAccount(account, account);
    IRewardTracker(feeXlxTracker).claimForAccount(account, account);

    IRewardTracker(stakedXdxTracker).claimForAccount(account, account);
    IRewardTracker(stakedXlxTracker).claimForAccount(account, account);
  }

  function claimEsXdx() external nonReentrant {
    address account = msg.sender;

    IRewardTracker(stakedXdxTracker).claimForAccount(account, account);
    IRewardTracker(stakedXlxTracker).claimForAccount(account, account);
  }

  function claimFees() external nonReentrant {
    address account = msg.sender;

    IRewardTracker(feeXdxTracker).claimForAccount(account, account);
    IRewardTracker(feeXlxTracker).claimForAccount(account, account);
  }

  function compound() external nonReentrant {
    _compound(msg.sender);
  }

  function compoundForAccount(address _account) external nonReentrant onlyGov {
    _compound(_account);
  }

  function batchCompoundForAccounts(address[] memory _accounts) external nonReentrant onlyGov {
    for (uint256 i = 0; i < _accounts.length; i++) {
      _compound(_accounts[i]);
    }
  }

  function _compound(address _account) private {
    _compoundXdx(_account);
    _compoundXlx(_account);
  }

  function _compoundXdx(address _account) private {
    uint256 esXdxAmount = IRewardTracker(stakedXdxTracker).claimForAccount(_account, _account);
    if (esXdxAmount > 0) {
      _stakeXdx(_account, _account, esXdx, esXdxAmount);
    }

    uint256 bnXdxAmount = IRewardTracker(bonusXdxTracker).claimForAccount(_account, _account);
    if (bnXdxAmount > 0) {
      IRewardTracker(feeXdxTracker).stakeForAccount(_account, _account, bnXdx, bnXdxAmount);
    }
  }

  function _compoundXlx(address _account) private {
    uint256 esXdxAmount = IRewardTracker(stakedXlxTracker).claimForAccount(_account, _account);
    if (esXdxAmount > 0) {
      _stakeXdx(_account, _account, esXdx, esXdxAmount);
    }
  }

  function _stakeXdx(
    address _fundingAccount,
    address _account,
    address _token,
    uint256 _amount
  ) private {
    require(_amount > 0, "RewardRouter: invalid _amount");

    IRewardTracker(stakedXdxTracker).stakeForAccount(_fundingAccount, _account, _token, _amount);
    IRewardTracker(bonusXdxTracker).stakeForAccount(_account, _account, stakedXdxTracker, _amount);
    IRewardTracker(feeXdxTracker).stakeForAccount(_account, _account, bonusXdxTracker, _amount);

    emit StakeXdx(_account, _amount);
  }

  function _unstakeXdx(
    address _account,
    address _token,
    uint256 _amount
  ) private {
    require(_amount > 0, "RewardRouter: invalid _amount");

    uint256 balance = IRewardTracker(stakedXdxTracker).stakedAmounts(_account);

    IRewardTracker(feeXdxTracker).unstakeForAccount(_account, bonusXdxTracker, _amount, _account);
    IRewardTracker(bonusXdxTracker).unstakeForAccount(
      _account,
      stakedXdxTracker,
      _amount,
      _account
    );
    IRewardTracker(stakedXdxTracker).unstakeForAccount(_account, _token, _amount, _account);

    uint256 bnXdxAmount = IRewardTracker(bonusXdxTracker).claimForAccount(_account, _account);
    if (bnXdxAmount > 0) {
      IRewardTracker(feeXdxTracker).stakeForAccount(_account, _account, bnXdx, bnXdxAmount);
    }

    uint256 stakedBnXdx = IRewardTracker(feeXdxTracker).depositBalances(_account, bnXdx);
    if (stakedBnXdx > 0) {
      uint256 reductionAmount = stakedBnXdx.mul(_amount).div(balance);
      IRewardTracker(feeXdxTracker).unstakeForAccount(_account, bnXdx, reductionAmount, _account);
      IMintable(bnXdx).burn(_account, reductionAmount);
    }

    emit UnstakeXdx(_account, _amount);
  }
}
