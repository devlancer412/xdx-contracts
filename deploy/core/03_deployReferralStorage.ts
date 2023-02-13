import { DeployFunction } from "hardhat-deploy/types";
import { PositionRouter__factory, ReferralStorage__factory } from "../../types";
import { Ship } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const positionRouter = await connect(PositionRouter__factory);

  const referralStorage = await deploy(ReferralStorage__factory);
  if (referralStorage.newlyDeployed) {
    let tx = await referralStorage.contract.setHandler(positionRouter.address, true);
    console.log("Set PositionRouter as handler of ReferralStorage at ", tx.hash);
    await tx.wait();
    tx = await positionRouter.setReferralStorage(referralStorage.address);
    console.log("Set ReferralStorage to PositionRouter at ", tx.hash);
    await tx.wait();
  }
};

export default func;
func.tags = ["referralStorage"];
func.dependencies = ["positionRouter"];
