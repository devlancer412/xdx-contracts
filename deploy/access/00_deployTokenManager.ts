import { DeployFunction } from "hardhat-deploy/types";
import { TokenManager__factory } from "../../types";
import { Ship } from "../../utils";
import { signers as configSigners } from "../../config";

const func: DeployFunction = async (hre) => {
  const { deploy, accounts } = await Ship.init(hre);

  const { signer1, signer2 } = accounts;
  let signers: string[] = [];

  if (hre.network.tags.prod) {
    signers = configSigners;
  } else {
    signers = [signer1.address, signer2.address];
  }

  const tokenManager = await deploy(TokenManager__factory, {
    args: [signers.length],
  });

  if (tokenManager.newlyDeployed) {
    await tokenManager.contract.initialize(signers);
  }
};

export default func;
func.tags = ["tokenManager"];
