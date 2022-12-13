import { DeployFunction } from "hardhat-deploy/types";
import { RewardTracker__factory } from "../types";
import { Ship } from "../utils";

const func: DeployFunction = async (hre) => {
  const { deploy } = await Ship.init(hre);

  await deploy(RewardTracker__factory, {
    aliasName: "StakedXdxTracker",
    args: ["Staked XDX", "sXDX"],
  });

  await deploy(RewardTracker__factory, {
    aliasName: "BonusXdxTracker",
    args: ["Staked + Bonus XDX", "sbXDX"],
  });

  await deploy(RewardTracker__factory, {
    aliasName: "FeeXdxTracker",
    args: ["Staked + Bonus + Fee XDX", "sbfXDX"],
  });

  await deploy(RewardTracker__factory, {
    aliasName: "StakedXlxTracker",
    args: ["Fee + Staked XLX ", "fsXLX"],
  });

  await deploy(RewardTracker__factory, {
    aliasName: "FeeXlxTracker",
    args: ["Fee XLX", "fXLX"],
  });
};

export default func;
func.tags = ["rewardTracker"];
func.dependencies = ["tokens"];
