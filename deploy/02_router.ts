import { DeployFunction } from "hardhat-deploy/types";
import { Vault__factory, USDG__factory, Router__factory, Token__factory, PriceFeed__factory } from "../types";
import { getChainId } from "hardhat";
import { Ship } from "../utils";
import tokens from "./../config/tokens";
import {} from "types";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);
  const chainID = await getChainId();

  let wethAddress: string;
  if (chainID == "1337") {
    wethAddress = (
      await deploy(Token__factory, {
        aliasName: "WETH",
        args: ["WETH", "Wrapped ETH", 18],
      })
    ).address;
    await deploy(PriceFeed__factory, {
      aliasName: "EthPriceFeed",
    });
  } else {
    wethAddress = tokens[chainID].weth.address;
  }
  const vault = await connect(Vault__factory);
  const usdg = await connect(USDG__factory);
  await deploy(Router__factory, {
    args: [vault.address, usdg.address, wethAddress],
  });
};

export default func;
func.tags = ["router"];
func.dependencies = ["tokens"];
