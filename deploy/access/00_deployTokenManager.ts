import { DeployFunction } from "hardhat-deploy/types";
import { TokenManager__factory } from "../../types";
import { Ship } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, accounts } = await Ship.init(hre);

  const { deployer, signer, alice, bob } = accounts;
  const tokenManager = await deploy(TokenManager__factory, {
    args: [4],
  });

  if (tokenManager.newlyDeployed) {
    let signers: string[] = [];

    if (hre.network.tags.prod) {
      signers = ["0x45e48668F090a3eD1C7961421c60Df4E66f693BD"];
    } else {
      signers = [deployer.address, signer.address, alice.address, bob.address];
    }

    await tokenManager.contract.initialize(signers);
  }
};

export default func;
func.tags = ["tokenManager"];
