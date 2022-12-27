import { deployments } from "hardhat";
import {
  EsXDX__factory,
  MintableBaseToken,
  RewardDistributor,
  RewardRouterV2__factory,
  RewardTracker,
  TokenManager__factory,
  Vester,
  XlxManager__factory,
} from "../types";
import { Ship } from "../utils";

const main = async () => {
  const setup = deployments.createFixture(async (hre) => {
    const ship = await Ship.init(hre);
    const { accounts, users } = ship;
    await deployments.fixture([
      "tokenManager",
      "bonusXdxTracker",
      "feeXdxTracker",
      "feeXlxTracker",
      "stakedXlxTracker",
      "stakedXdxDistributor",
      "stakedXlxDistributor",
      "esXdx",
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

  const deployer = scaffold.accounts.deployer;

  const tokenManager = await scaffold.ship.connect(TokenManager__factory);
  const rewardRouter = await scaffold.ship.connect(RewardRouterV2__factory);
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
