// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IRewardRouterV2 {
  function feeXlxTracker() external view returns (address);

  function stakedXlxTracker() external view returns (address);
}
