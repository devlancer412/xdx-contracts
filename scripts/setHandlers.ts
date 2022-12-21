import { BigNumber, ContractReceipt } from "ethers";
import * as fs from "fs";
import { deployments, ethers } from "hardhat";
import { GWITToken__factory, Marketplace__factory, Rooster__factory } from "../types";
import { Ship, Time } from "../utils";
const csvToObj = require("csv-to-js-parser").csvToObj;

interface List {
  amount: number;
  address: string;
}

const main = async () => {
  const setup = deployments.createFixture(async (hre) => {
    const ship = await Ship.init(hre);
    const { accounts, users } = ship;
    await deployments.fixture(["mocks", "grp", "gwit", "marketplace", "nfts", "gwit_init"]);

    return {
      ship,
      accounts,
      users,
    };
  });

  const getId = (rx: ContractReceipt) => {
    const events = rx.events ?? [];
    for (const ev of events) {
      if (ev.event === "Transfer" && ev.args?.to === seller.address) {
        return ev.args.id;
      }
    }
  };

  const scaffold = await setup();
  const seller = scaffold.users[0];

  await esXdx.setHandler(tokenManager.address, true);
  await xdxVester.setHandler(deployer.address, true);

  await esXdx.setHandler(rewardRouter.address, true);
  await esXdx.setHandler(stakedXdxDistributor.address, true);
  await esXdx.setHandler(stakedXlxDistributor.address, true);
  await esXdx.setHandler(stakedXdxTracker.address, true);
  await esXdx.setHandler(stakedXlxTracker.address, true);
  await esXdx.setHandler(xdxVester.address, true);
  await esXdx.setHandler(xlxVester.address, true);

  await xlxManager.setHandler(rewardRouter.address, true);
  await stakedXdxTracker.setHandler(rewardRouter.address, true);
  await bonusXdxTracker.setHandler(rewardRouter.address, true);
  await feeXdxTracker.setHandler(rewardRouter.address, true);
  await feeXlxTracker.setHandler(rewardRouter.address, true);
  await stakedXlxTracker.setHandler(rewardRouter.address, true);

  await esXdx.setHandler(rewardRouter.address, true);
  await bnXdx.setMinter(rewardRouter.address, true);
  await esXdx.setMinter(xdxVester.address, true);
  await esXdx.setMinter(xlxVester.address, true);

  await xdxVester.setHandler(rewardRouter.address, true);
  await xlxVester.setHandler(rewardRouter.address, true);

  await feeXdxTracker.setHandler(xdxVester.address, true);
  await stakedXlxTracker.setHandler(xlxVester.address, true);
};

main()
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(err);
    process.exit(1);
  });
