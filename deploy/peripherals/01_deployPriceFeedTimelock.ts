import { DeployFunction } from "hardhat-deploy/types";
import { PriceFeedTimelock__factory, TokenManager__factory } from "../../types";
import { Ship } from "../../utils";
import { signers as configSigners, keepers as configKeepers } from "../../config/accounts";

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);

  const { deployer, signer, keeper1, keeper2 } = accounts;
  const buffer = 24 * 60 * 60;
  let signers: string[];
  let keepers: string[];

  if (hre.network.tags.prod) {
    signers = configSigners;
    keepers = configKeepers;
  } else {
    signers = [signer.address];
    keepers = [keeper1.address, keeper2.address];
  }

  const tokenManager = await connect(TokenManager__factory);

  const priceFeedTimelock = await deploy(PriceFeedTimelock__factory, {
    args: [deployer.address, buffer, tokenManager.address],
  });

  if (priceFeedTimelock.newlyDeployed) {
    for (const signer of signers) {
      await priceFeedTimelock.contract.setContractHandler(signer, true);
    }

    for (const keeper of keepers) {
      await priceFeedTimelock.contract.setKeeper(keeper, true);
    }
  }
};

export default func;
func.tags = ["priceFeedTimelock"];
func.dependencies = ["tokenManager"];
