import { DeployFunction } from "hardhat-deploy/types";
import { BalanceUpdater__factory } from "../../types";
import { Ship } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy } = await Ship.init(hre);

  await deploy(BalanceUpdater__factory);
};

export default func;
func.tags = ["balanceUpdater"];
