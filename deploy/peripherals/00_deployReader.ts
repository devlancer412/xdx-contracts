import { DeployFunction } from "hardhat-deploy/types";
import { Reader__factory } from "../../types";
import { Ship } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy } = await Ship.init(hre);

  const reader = await deploy(Reader__factory);

  if (reader.newlyDeployed) {
    await reader.contract.setConfig(true);
  }
};

export default func;
func.tags = ["reader"];
