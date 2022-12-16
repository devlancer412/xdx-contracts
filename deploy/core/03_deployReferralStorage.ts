import { DeployFunction } from "hardhat-deploy/types";
import { PositionRouter__factory, ReferralStorage__factory } from "../../types";
import { Ship } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const positionRouter = await connect(PositionRouter__factory);

  const referralStorage = await deploy(ReferralStorage__factory);
  if (referralStorage.newlyDeployed) {
    await referralStorage.contract.setHandler(positionRouter.address, true);
    await positionRouter.setReferralStorage(referralStorage.address);
  }
};

export default func;
func.tags = ["referralStorage"];
func.dependencies = ["positionRouter"];
