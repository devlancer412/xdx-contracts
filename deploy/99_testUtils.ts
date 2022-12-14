import { DeployFunction } from "hardhat-deploy/types";
import {
  Token__factory,
  PriceFeed__factory,
  Vault__factory,
  USDG__factory,
  TimeDistributor__factory,
  YieldTracker__factory,
} from "../types";
import { Ship } from "../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const bnb = await deploy(Token__factory, {
    aliasName: "WBNB",
    args: ["WBNB", "Wrapped BNB", 18],
  });

  await deploy(PriceFeed__factory, {
    aliasName: "BnbPriceFeed",
  });

  await deploy(Token__factory, {
    aliasName: "WBTC",
    args: ["WBTC", "Wrapped BTC", 8],
  });

  await deploy(PriceFeed__factory, {
    aliasName: "BtcPriceFeed",
  });

  await deploy(PriceFeed__factory, {
    aliasName: "EthPriceFeed",
  });

  await deploy(Token__factory, {
    aliasName: "DAI",
    args: ["DAI", "Wrapped DAI", 18],
  });

  await deploy(PriceFeed__factory, {
    aliasName: "DaiPriceFeed",
  });

  await deploy(Token__factory, {
    aliasName: "BUSD",
    args: ["BNB", "Wrapped BNB", 18],
  });

  await deploy(PriceFeed__factory, {
    aliasName: "BusdPriceFeed",
  });

  const usdg = await connect(USDG__factory);

  const distributor = await deploy(TimeDistributor__factory);
  const yieldTracker = await deploy(YieldTracker__factory, { args: [usdg.address] });

  await yieldTracker.contract.setDistributor(distributor.address);
  await distributor.contract.setDistribution([yieldTracker.address], [1000], [bnb.address]);

  await bnb.contract.mint(distributor.address, 5000);
  await usdg.setYieldTrackers([yieldTracker.address]);
};

export default func;
func.tags = ["testUtils"];
