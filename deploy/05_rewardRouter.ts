import { DeployFunction } from "hardhat-deploy/types";
import { RewardRouter__factory } from "../types";
import { Ship } from "../utils";

const func: DeployFunction = async (hre) => {
  const { deploy } = await Ship.init(hre);

  await deploy(RewardRouter__factory);
};

export default func;
func.tags = ["rewardRouter"];
