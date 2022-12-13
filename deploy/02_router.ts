import { DeployFunction } from "hardhat-deploy/types";
import { Vault__factory, USDG__factory, Router__factory } from "../types";
import { getChainId } from "hardhat";
import { Ship } from "../utils";
import tokens from "./../config/tokens";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);
  const chainID = await getChainId();

  const vault = await connect(Vault__factory);
  const usdg = await connect(USDG__factory);
  await deploy(Router__factory, {
    args: [vault.address, usdg.address, tokens[chainID].weth.address],
  });
};

export default func;
func.tags = ["router"];
func.dependencies = ["tokens"];
