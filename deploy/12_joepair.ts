import { DeployFunction } from "hardhat-deploy/types";
import { JoePair__factory, ReferralStorage__factory, ReferralReader__factory } from "../types";
import { Ship } from "../utils";

const func: DeployFunction = async (hre) => {
  const { deploy } = await Ship.init(hre);

  await deploy(JoePair__factory);
  await deploy(ReferralStorage__factory);
  await deploy(ReferralReader__factory);
};

export default func;
func.tags = ["joepair"];
