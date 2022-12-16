import { DeployFunction } from "hardhat-deploy/types";
import { VaultReader__factory } from "../../types";
import { Ship } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy } = await Ship.init(hre);

  await deploy(VaultReader__factory);
};

export default func;
func.tags = ["vaultReader"];
