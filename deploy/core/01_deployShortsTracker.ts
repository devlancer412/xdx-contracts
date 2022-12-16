import { DeployFunction } from "hardhat-deploy/types";
import { ShortsTracker__factory, Vault__factory } from "../../types";
import { Ship } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const vault = await connect(Vault__factory);

  const shortsTracker = await deploy(ShortsTracker__factory, {
    args: [vault.address],
  });
  if (shortsTracker.newlyDeployed) {
    await shortsTracker.contract.setGov(await vault.gov());
  }
};

export default func;
func.tags = ["shortsTracker"];
func.dependencies = ["vault"];
