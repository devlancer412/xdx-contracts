import { DeployFunction } from "hardhat-deploy/types";
import { EsXDX__factory, RewardDistributor__factory } from "../types";
import { Ship } from "../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const esXdx = await connect(EsXDX__factory);
  const stakedXdxTracker = await connect("StakedXdxTracker");
  const stakedXlxTracker = await connect("StakedXlxTracker");

  await deploy(RewardDistributor__factory, {
    aliasName: "StakedXdxDistributor",
    args: [esXdx.address, stakedXdxTracker.address],
  });

  await deploy(RewardDistributor__factory, {
    aliasName: "StakedXlxDistributor",
    args: [esXdx.address, stakedXlxTracker.address],
  });
};

export default func;
func.tags = ["rewardDistributor"];
func.dependencies = ["rewardTracker"];
