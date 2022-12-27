import { deployments } from "hardhat";
import {
  EsXDX__factory,
  MintableBaseToken,
  RewardDistributor,
  RewardTracker,
  Timelock__factory,
  Vester,
  XlxManager__factory,
} from "../types";
import { Ship } from "../utils";

const main = async () => {
  const setup = deployments.createFixture(async (hre) => {
    const ship = await Ship.init(hre);
    const { accounts, users } = ship;
    await deployments.fixture([
      "timelock",
      "xlxManager",
      "stakedXdxTracker",
      "bonusXdxTracker",
      "feeXdxTracker",
      "feeXlxTracker",
      "stakedXlxTracker",
      "stakedXdxDistributor",
      "stakedXlxDistributor",
      "esXdx",
      "bnXdx",
      "xdxVester",
      "xlxVester",
    ]);

    return {
      ship,
      accounts,
      users,
    };
  });

  const scaffold = await setup();

  const timelock = await scaffold.ship.connect(Timelock__factory);
  const xlxManager = await scaffold.ship.connect(XlxManager__factory);
  const stakedXdxTracker = (await scaffold.ship.connect("StakedXdxTracker")) as RewardTracker;
  const bonusXdxTracker = (await scaffold.ship.connect("BonusXdxTracker")) as RewardTracker;
  const feeXdxTracker = (await scaffold.ship.connect("FeeXdxTracker")) as RewardTracker;
  const feeXlxTracker = (await scaffold.ship.connect("FeeXlxTracker")) as RewardTracker;
  const stakedXlxTracker = (await scaffold.ship.connect("StakedXlxTracker")) as RewardTracker;
  const stakedXdxDistributor = (await scaffold.ship.connect("StakedXdxDistributor")) as RewardDistributor;
  const stakedXlxDistributor = (await scaffold.ship.connect("StakedXlxDistributor")) as RewardDistributor;
  const esXdx = await scaffold.ship.connect(EsXDX__factory);
  const bnXdx = (await scaffold.ship.connect("BN_XDX")) as MintableBaseToken;
  const xdxVester = (await scaffold.ship.connect("XdxVester")) as Vester;
  const xlxVester = (await scaffold.ship.connect("XlxVester")) as Vester;

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
