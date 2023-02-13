import { DeployFunction } from "hardhat-deploy/types";
import { ShortsTrackerTimelock__factory } from "../../types";
import { Ship } from "../../utils";
import { handlers as configHandlers } from "../../config";

const func: DeployFunction = async (hre) => {
  const { deploy, accounts } = await Ship.init(hre);

  const { deployer, handler1, handler2 } = accounts;
  let handlers: string[];

  if (hre.network.tags.prod) {
    handlers = configHandlers;
  } else {
    handlers = [handler1.address, handler2.address];
  }

  const buffer = 60; // 60 seconds
  const updateDelay = 300; // 300 seconds, 5 minutes
  const maxAveragePriceChange = 20; // 0.2%
  const shortsTrackerTimelock = await deploy(ShortsTrackerTimelock__factory, {
    args: [deployer.address, buffer, updateDelay, maxAveragePriceChange],
  });

  if (shortsTrackerTimelock.newlyDeployed) {
    for (const handler of handlers) {
      const tx = await shortsTrackerTimelock.contract.setHandler(handler, true);
      console.log("Set ", handler, " to handler of ShortsTrackerTimelock at ", tx.hash);
      await tx.wait();
    }
  }
};

export default func;
func.tags = ["shortsTrackerTimelock"];
