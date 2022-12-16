import { DeployFunction } from "hardhat-deploy/types";
import { BatchSender__factory } from "../../types";
import { Ship } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy } = await Ship.init(hre);

  await deploy(BatchSender__factory);
};

export default func;
func.tags = ["batchSender"];
