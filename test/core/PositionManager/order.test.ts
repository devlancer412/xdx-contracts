import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  XlxManager,
  XlxManager__factory,
  Vault,
  MintableBaseToken,
  USDG,
  VaultPriceFeed,
  Token,
  PriceFeed,
  Vault__factory,
  USDG__factory,
  VaultPriceFeed__factory,
  VaultUtils,
  PositionManager,
  Router,
  TimeDistributor,
  YieldTracker,
  OrderBook,
  VaultUtils__factory,
  Router__factory,
  TimeDistributor__factory,
  YieldTracker__factory,
  OrderBook__factory,
  Timelock__factory,
  PositionManager__factory,
  Timelock,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";
import { getBtcConfig, getDaiConfig, getEthConfig } from "../Vault/helper";
import { BigNumberish, constants } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultUtils: VaultUtils;
let vaultPriceFeed: VaultPriceFeed;
let positionManager: PositionManager;
let usdg: USDG;
let router: Router;
let eth: Token;
let ethPriceFeed: PriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let dai: Token;
let daiPriceFeed: PriceFeed;
let distributor: TimeDistributor;
let yieldTracker: YieldTracker;
let orderbook: OrderBook;
let timelock: Timelock;

let xlxManager: XlxManager;
let xlx: MintableBaseToken;

let alice: SignerWithAddress;
let bob: SignerWithAddress;
let rewardRouter: SignerWithAddress;
let deployer: SignerWithAddress;
let user: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["xlxManager", "orderbook", "testUtils", "initVault", "reader", "position"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("PositionManager - order", () => {
  before(async () => {
    const scaffold = await setup();

    alice = scaffold.accounts.alice;
    bob = scaffold.accounts.bob;
    deployer = scaffold.accounts.deployer;
    rewardRouter = scaffold.accounts.signer;
    user = scaffold.users[0];

    const { connect } = scaffold.ship;

    eth = (await connect("WETH")) as Token;
    ethPriceFeed = (await connect("EthPriceFeed")) as PriceFeed;

    btc = (await connect("WBTC")) as Token;
    btcPriceFeed = (await connect("BtcPriceFeed")) as PriceFeed;

    dai = (await connect("DAI")) as Token;
    daiPriceFeed = (await connect("DaiPriceFeed")) as PriceFeed;

    vault = await connect(Vault__factory);
    vaultUtils = await connect(VaultUtils__factory);
    await vault.setIsLeverageEnabled(false);
    usdg = await connect(USDG__factory);
    router = await connect(Router__factory);
    vaultPriceFeed = await connect(VaultPriceFeed__factory);

    distributor = await connect(TimeDistributor__factory);
    yieldTracker = await connect(YieldTracker__factory);

    await eth.mint(distributor.address, 5000);
    await usdg.setYieldTrackers([yieldTracker.address]);

    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false);
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false);
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false);

    orderbook = await connect(OrderBook__factory);
    const minExecutionFee = 500000;
    await orderbook.initialize(
      router.address,
      vault.address,
      eth.address,
      usdg.address,
      minExecutionFee,
      toWei(5, 30), // minPurchseTokenAmountUsd
    );
    await router.addPlugin(orderbook.address);
    await router.connect(deployer).approvePlugin(orderbook.address);

    xlx = (await connect("XLX")) as MintableBaseToken;
    xlxManager = await connect(XlxManager__factory);
    positionManager = await connect(PositionManager__factory);

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed));

    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(3000));
    await vault.setTokenConfig(...getEthConfig(eth, ethPriceFeed));

    await eth.mint(alice.address, toWei(1000));
    await eth.connect(alice).approve(router.address, toWei(1000));
    await router.connect(alice).swap([eth.address, usdg.address], toWei(1000), toWei(29000), alice.address);

    await dai.mint(alice.address, toWei(500000));
    await dai.connect(alice).approve(router.address, toWei(300000));
    await router.connect(alice).swap([dai.address, usdg.address], toWei(300000), toWei(29000), alice.address);

    await btc.mint(alice.address, toWei(10));
    await btc.connect(alice).approve(router.address, toWei(10));
    await router.connect(alice).swap([btc.address, usdg.address], toWei(10), toWei(59000), alice.address);

    await vault.setInManagerMode(true);

    timelock = (
      await ship.deploy(Timelock__factory, {
        args: [
          deployer.address, // _admin
          5 * 24 * 60 * 60, // _buffer
          constants.AddressZero, // _tokenManager
          constants.AddressZero, // _mintReceiver
          constants.AddressZero, // _xlxManager
          constants.AddressZero, // _rewardRouter
          toWei(1000, 18), // _maxTokenSupply
          10, // _marginFeeBasisPoints
          100, // _maxMarginFeeBasisPoints
        ],
      })
    ).contract;

    await vault.setGov(timelock.address);
    await router.addPlugin(positionManager.address);
    await router.connect(alice).approvePlugin(positionManager.address);
    await router.connect(alice).approvePlugin(orderbook.address);
    await timelock.setContractHandler(positionManager.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);
  });

  it("executeSwapOrder", async () => {
    await dai.mint(alice.address, toWei(1000, 18));
    await dai.connect(alice).approve(router.address, toWei(100, 18));
    await orderbook.connect(alice).createSwapOrder(
      [dai.address, btc.address],
      toWei(100, 18), //amountIn,
      0,
      0,
      true,
      toWei(1, 17),
      false,
      false,
      { value: toWei(1, 17) },
    );
    const orderIndex = (await orderbook.swapOrdersIndex(alice.address)).toNumber() - 1;

    await expect(
      positionManager.connect(bob).executeSwapOrder(alice.address, orderIndex, bob.address),
    ).to.be.revertedWith("PositionManager: forbidden");

    const balanceBefore = await ship.provider.getBalance(bob.address);
    await positionManager.setOrderKeeper(bob.address, true);
    await positionManager.connect(bob).executeSwapOrder(alice.address, orderIndex, bob.address);
    expect((await orderbook.swapOrders(alice.address, orderIndex))[0]).to.be.equal(constants.AddressZero);
    const balanceAfter = await ship.provider.getBalance(bob.address);
    expect(balanceAfter.gt(balanceBefore)).to.be.true;

    await positionManager.setOrderKeeper(bob.address, false);
  });

  it("executeIncreaseOrder", async () => {
    const executionFee = toWei(1, 17); // 0.1 WETH
    await dai.mint(alice.address, toWei(20000, 18));
    await dai.connect(alice).approve(router.address, toWei(20000, 18));

    const createIncreaseOrder = (
      amountIn: BigNumberish = toWei(1000, 18),
      sizeDelta: BigNumberish = toUsd(2000),
      isLong = true,
    ) => {
      const path = isLong ? [dai.address, btc.address] : [dai.address];
      const collateralToken = isLong ? btc.address : dai.address;
      return orderbook.connect(alice).createIncreaseOrder(
        path,
        amountIn,
        btc.address, // indexToken
        0, // minOut
        sizeDelta,
        collateralToken,
        isLong,
        toUsd(59000), // triggerPrice
        true, // triggerAboveThreshold
        executionFee,
        false, // shouldWrap
        { value: executionFee },
      );
    };

    await createIncreaseOrder();

    let orderIndex = (await orderbook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    expect(await positionManager.isOrderKeeper(bob.address)).to.be.false;
    await expect(
      positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address),
    ).to.be.revertedWith("PositionManager: forbidden");

    const balanceBefore = await ship.provider.getBalance(bob.address);
    await positionManager.setOrderKeeper(bob.address, true);
    expect(await positionManager.isOrderKeeper(bob.address)).to.be.true;
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address);
    expect((await orderbook.increaseOrders(alice.address, orderIndex))[0]).to.be.equal(constants.AddressZero);
    const balanceAfter = await ship.provider.getBalance(bob.address);
    expect(balanceAfter.gt(balanceBefore)).to.be.true;

    const position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).to.be.equal(toUsd(2000));

    // by default validation is enabled
    expect(await positionManager.shouldValidateIncreaseOrder()).to.be.true;

    // should revert on deposits
    await createIncreaseOrder(toWei(100, 18), 0);
    orderIndex = (await orderbook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    const badOrderIndex1 = orderIndex;
    await expect(
      positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address),
    ).to.be.revertedWith("PositionManager: long deposit");

    // should block if leverage is decreased
    await createIncreaseOrder(toWei(100, 18), toUsd(100));
    orderIndex = (await orderbook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    const badOrderIndex2 = orderIndex;
    await expect(
      positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address),
    ).to.be.revertedWith("PositionManager: long leverage decrease");

    // should not block if leverage is not decreased
    await createIncreaseOrder();
    orderIndex = (await orderbook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address);

    await positionManager.setShouldValidateIncreaseOrder(false);
    expect(await positionManager.shouldValidateIncreaseOrder()).to.be.false;

    await positionManager.connect(bob).executeIncreaseOrder(alice.address, badOrderIndex1, bob.address);
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, badOrderIndex2, bob.address);

    // shorts
    await positionManager.setShouldValidateIncreaseOrder(true);
    expect(await positionManager.shouldValidateIncreaseOrder()).to.be.true;

    await createIncreaseOrder(toWei(1000, 18), toUsd(2000), false);
    orderIndex = (await orderbook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address);

    // should not block deposits for shorts
    await createIncreaseOrder(toWei(100, 18), 0, false);
    orderIndex = (await orderbook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address);

    await createIncreaseOrder(toWei(100, 18), toUsd(100), false);
    orderIndex = (await orderbook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address);
  });

  it("liquidatePosition", async () => {
    expect(await positionManager.isLiquidator(bob.address)).to.be.false;
    await expect(
      positionManager
        .connect(bob)
        .liquidatePosition(bob.address, eth.address, eth.address, true, alice.address),
    ).to.be.revertedWith("PositionManager: forbidden");

    await positionManager.setInLegacyMode(true);
    await router.addPlugin(positionManager.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    await positionManager
      .connect(alice)
      .increasePositionETH([eth.address], eth.address, 0, toUsd(10000), true, toUsd(100000), {
        value: toWei(1, 18),
      });
    const position = await vault.getPosition(alice.address, eth.address, eth.address, true);

    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(200));

    await expect(
      positionManager
        .connect(bob)
        .liquidatePosition(alice.address, eth.address, eth.address, true, bob.address),
    ).to.be.revertedWith("PositionManager: forbidden");

    await positionManager.setLiquidator(bob.address, true);

    expect(await positionManager.isLiquidator(bob.address)).to.be.true;
    await positionManager
      .connect(bob)
      .liquidatePosition(alice.address, eth.address, eth.address, true, bob.address);
  });
});
