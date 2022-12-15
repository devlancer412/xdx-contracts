import { DeployFunction } from "hardhat-deploy/types";
import {
  Vault__factory,
  USDG__factory,
  XLX__factory,
  XlxManager__factory,
  ShortsTracker__factory,
} from "../types";
import { Ship } from "../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const vault = await connect(Vault__factory);
  const usdg = await connect(USDG__factory);
  const xlx = await connect(XLX__factory);

  const shortsTracker = await deploy(ShortsTracker__factory, {
    args: [vault.address],
  });
  await shortsTracker.contract.setIsGlobalShortDataReady(false);

  const xlxManager = await deploy(XlxManager__factory, {
    args: [vault.address, usdg.address, xlx.address, shortsTracker.address, 24 * 60 * 60],
  });

  await xlxManager.contract.setShortsTrackerAveragePriceWeight(10000);
};

export default func;
func.tags = ["xlxManager"];
func.dependencies = ["tokens"];
