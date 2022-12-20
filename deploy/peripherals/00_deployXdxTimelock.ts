import { DeployFunction } from "hardhat-deploy/types";
import { TokenManager__factory, XdxTimelock__factory } from "../../types";
import { Ship, toWei } from "../../utils";
import { ethers } from "ethers";

const { AddressZero } = ethers.constants;

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);

  const { deployer } = accounts;

  const admin = deployer.address;
  const rewardManager = { address: AddressZero };
  const buffer = 24 * 60 * 60;
  const longBuffer = 7 * 24 * 60 * 60;
  const tokenManager = await connect(TokenManager__factory);
  const mintReceiver = deployer;
  const maxTokenSupply = toWei(13250000, 18);

  await deploy(XdxTimelock__factory, {
    args: [
      admin,
      buffer,
      longBuffer,
      rewardManager.address,
      tokenManager.address,
      mintReceiver.address,
      maxTokenSupply,
    ],
  });
};

export default func;
func.tags = ["xdxTimelock"];
func.dependencies = ["tokens"];
