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

  await xlxManager.setGov(timelock.address);
  await stakedXdxTracker.setGov(timelock.address);
  await bonusXdxTracker.setGov(timelock.address);
  await feeXdxTracker.setGov(timelock.address);
  await feeXlxTracker.setGov(timelock.address);
  await stakedXlxTracker.setGov(timelock.address);
  await stakedXdxDistributor.setGov(timelock.address);
  await stakedXlxDistributor.setGov(timelock.address);
  await esXdx.setGov(timelock.address);
  await bnXdx.setGov(timelock.address);
  await xdxVester.setGov(timelock.address);
  await xlxVester.setGov(timelock.address);
};

main()
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(err);
    process.exit(1);
  });
