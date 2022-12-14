import { DeployFunction } from "hardhat-deploy/types";
import tokens from "../config/tokens";
import {
  OrderBook__factory,
  PositionManager__factory,
  PositionRouter__factory,
  Router__factory,
  ShortsTracker__factory,
  Vault__factory,
} from "../types";
import { Ship } from "../utils";
import { BigNumber } from "ethers";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const chainId = await hre.getChainId();

  let wethAddress: string;
  if (chainId == "1337") {
    wethAddress = (await connect("WETH")).address;
  } else {
    wethAddress = tokens[chainId].weth.address;
  }

  const vault = await connect(Vault__factory);
  const router = await connect(Router__factory);
  const orderbook = await connect(OrderBook__factory);
  const shortsTracker = await connect(ShortsTracker__factory);
  await deploy(PositionRouter__factory, {
    args: [
      vault.address,
      router.address,
      wethAddress,
      shortsTracker.address,
      30,
      BigNumber.from("17000000000000000"),
    ],
  });
  const positionManager = await deploy(PositionManager__factory, {
    args: [vault.address, router.address, shortsTracker.address, wethAddress, 50, orderbook.address],
  });
  await shortsTracker.setHandler(positionManager.address, true);
};

export default func;
func.tags = ["position"];
func.dependencies = ["orderbook", "router"];
