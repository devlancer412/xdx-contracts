import { deployments } from "hardhat";
import {
  EsXDX__factory,
  MintableBaseToken,
  OrderBook__factory,
  RewardDistributor,
  RewardRouterV2__factory,
  RewardTracker,
  Router__factory,
  TokenManager__factory,
  Vester,
  XlxManager__factory,
} from "../types";
import { Ship } from "../utils";

const main = async () => {
  const setup = deployments.createFixture(async (hre) => {
    const ship = await Ship.init(hre);
    const { accounts, users } = ship;
    // await deployments.fixture([
    //   "tokenManager",
    //   "bonusXdxTracker",
    //   "feeXdxTracker",
    //   "feeXlxTracker",
    //   "stakedXlxTracker",
    //   "stakedXdxDistributor",
    //   "stakedXlxDistributor",
    //   "esXdx",
    //   "xdxVester",
    //   "xlxVester",
    // ]);

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
  const router = await scaffold.ship.connect(Router__factory);
  const orderbook = await scaffold.ship.connect(OrderBook__factory);

  if (!(await esXdx.isHandler(tokenManager.address))) {
    const tx = await esXdx.setHandler(tokenManager.address, true);
    console.log("Set TokenManager to handler of EsXdx at", tx.hash);
    await tx.wait();
  }

  if (!(await xdxVester.isHandler(deployer.address))) {
    const tx = await xdxVester.setHandler(deployer.address, true);
    console.log("Set deployer to handler of XdxVester at", tx.hash);
    await tx.wait();
  }

  if (!(await esXdx.isHandler(rewardRouter.address))) {
    const tx = await esXdx.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of EsXdx at", tx.hash);
    await tx.wait();
  }
  if (!(await esXdx.isHandler(stakedXdxDistributor.address))) {
    const tx = await esXdx.setHandler(stakedXdxDistributor.address, true);
    console.log("Set StakedXdxDistributor to handler of EsXdx at", tx.hash);
    await tx.wait();
  }
  if (!(await esXdx.isHandler(stakedXlxDistributor.address))) {
    const tx = await esXdx.setHandler(stakedXlxDistributor.address, true);
    console.log("Set StakedXlxDistributor to handler of EsXdx at", tx.hash);
    await tx.wait();
  }
  if (!(await esXdx.isHandler(stakedXdxTracker.address))) {
    const tx = await esXdx.setHandler(stakedXdxTracker.address, true);
    console.log("Set StakedXdxTracker to handler of EsXdx at", tx.hash);
    await tx.wait();
  }
  if (!(await esXdx.isHandler(stakedXlxTracker.address))) {
    const tx = await esXdx.setHandler(stakedXlxTracker.address, true);
    console.log("Set StakedXlxTracker to handler of EsXdx at", tx.hash);
    await tx.wait();
  }
  if (!(await esXdx.isHandler(xdxVester.address))) {
    const tx = await esXdx.setHandler(xdxVester.address, true);
    console.log("Set XdxVester to handler of EsXdx at", tx.hash);
    await tx.wait();
  }
  if (!(await esXdx.isHandler(xlxVester.address))) {
    const tx = await esXdx.setHandler(xlxVester.address, true);
    console.log("Set XlxVester to handler of EsXdx at", tx.hash);
    await tx.wait();
  }

  if (!(await xlxManager.isHandler(rewardRouter.address))) {
    const tx = await xlxManager.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of XlxManager at", tx.hash);
    await tx.wait();
  }
  if (!(await stakedXdxTracker.isHandler(rewardRouter.address))) {
    const tx = await stakedXdxTracker.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of StakedXdxTracker at", tx.hash);
    await tx.wait();
  }
  if (!(await bonusXdxTracker.isHandler(rewardRouter.address))) {
    const tx = await bonusXdxTracker.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of BonusXdxTracker at", tx.hash);
    await tx.wait();
  }
  if (!(await feeXdxTracker.isHandler(rewardRouter.address))) {
    const tx = await feeXdxTracker.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of FeeXdxTracker at", tx.hash);
    await tx.wait();
  }
  if (!(await feeXlxTracker.isHandler(rewardRouter.address))) {
    const tx = await feeXlxTracker.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of FeeXlxTracker at", tx.hash);
    await tx.wait();
  }
  if (!(await stakedXlxTracker.isHandler(rewardRouter.address))) {
    const tx = await stakedXlxTracker.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of StakedXlxTracker at", tx.hash);
    await tx.wait();
  }
  if (!(await bnXdx.isHandler(rewardRouter.address))) {
    const tx = await bnXdx.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of BnXdx at", tx.hash);
    await tx.wait();
  }
  if (!(await esXdx.isHandler(rewardRouter.address))) {
    const tx = await esXdx.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of EsXdx at", tx.hash);
    await tx.wait();
  }
  if (!(await xdxVester.isHandler(rewardRouter.address))) {
    const tx = await xdxVester.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of XdxVester at", tx.hash);
    await tx.wait();
  }
  if (!(await xlxVester.isHandler(rewardRouter.address))) {
    const tx = await xlxVester.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of XlxVester at", tx.hash);
    await tx.wait();
  }

  if (!(await feeXdxTracker.isHandler(xdxVester.address))) {
    const tx = await feeXdxTracker.setHandler(xdxVester.address, true);
    console.log("Set XdxVester to handler of FeeXdxTracker at", tx.hash);
    await tx.wait();
  }
  if (!(await stakedXlxTracker.isHandler(xlxVester.address))) {
    const tx = await stakedXlxTracker.setHandler(xlxVester.address, true);
    console.log("Set XlxVester to handler of StakedXlxTracker at", tx.hash);
    await tx.wait();
  }

  if (!(await esXdx.isMinter(xdxVester.address))) {
    const tx = await esXdx.setMinter(xdxVester.address, true);
    console.log("Set XdxVester to minter of EsXdx at", tx.hash);
    await tx.wait();
  }
  if (!(await esXdx.isMinter(xlxVester.address))) {
    const tx = await esXdx.setMinter(xlxVester.address, true);
    console.log("Set XlxVester to minter of EsXdx at", tx.hash);
    await tx.wait();
  }

  if (!(await router.plugins(orderbook.address))) {
    const tx = await router.addPlugin(orderbook.address);
    console.log("Set orderbook as plugin of router at", tx.hash);
    await tx.wait();
  }
};

main()
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(err);
    process.exit(1);
  });
