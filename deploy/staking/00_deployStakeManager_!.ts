import { DeployFunction } from "hardhat-deploy/types";
import { StakeManager__factory } from "../../types";
import { Ship } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy } = await Ship.init(hre);

  await deploy(StakeManager__factory);
};

export default func;
func.tags = ["stakeManager"];
