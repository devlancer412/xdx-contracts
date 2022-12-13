import { DeployFunction } from "hardhat-deploy/types";
import {
  OrderBookReader__factory,
  OrderBook__factory,
  OrderExecutor__factory,
  Vault__factory,
} from "../types";
import { Ship } from "../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const vault = await connect(Vault__factory);
  const orderbook = await deploy(OrderBook__factory);
  await deploy(OrderBookReader__factory);
  await deploy(OrderExecutor__factory, { args: [vault.address, orderbook.address] });
};

export default func;
func.tags = ["orderbook"];
func.dependencies = ["tokens"];
