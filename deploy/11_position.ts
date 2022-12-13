import { DeployFunction } from "hardhat-deploy/types";
import tokens from "../config/tokens";
import {
  OrderBook__factory,
  PositionManager__factory,
  PositionRouter__factory,
  Router__factory,
  Vault__factory,
} from "../types";
import { Ship } from "../utils";
import { BigNumber } from "ethers";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const chainId = await hre.getChainId();

  const vault = await connect(Vault__factory);
  const router = await connect(Router__factory);
  const orderbook = await connect(OrderBook__factory);
  await deploy(PositionRouter__factory, {
    args: [
      vault.address,
      router.address,
      tokens[chainId].weth.address,
      30,
      BigNumber.from("17000000000000000"),
    ],
  });
  await deploy(PositionManager__factory, {
    args: [vault.address, router.address, tokens[chainId].weth.address, 50, orderbook.address],
  });
};

export default func;
func.tags = ["position"];
func.dependencies = ["orderbook", "router"];
