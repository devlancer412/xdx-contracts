import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  Vault,
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
  XLX,
  XLX__factory,
  XlxManager__factory,
  ShortsTracker,
  ShortsTracker__factory,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";
import { getBtcConfig, getDaiConfig, getEthConfig } from "../Vault/helper";
import { utils, constants, BigNumber } from "ethers";
import { XlxManager } from "types";

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
let shortsTracker: ShortsTracker;

let xlx: XLX;
let xlxManager: XlxManager;

let alice: SignerWithAddress;
let bob: SignerWithAddress;
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

describe("PositionManager - next short data calculations", () => {
  before(async () => {
    const scaffold = await setup();

    alice = scaffold.accounts.alice;
    bob = scaffold.accounts.bob;
    deployer = scaffold.accounts.deployer;
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

    xlx = await connect(XLX__factory);
    shortsTracker = await connect(ShortsTracker__factory);
    xlxManager = await connect(XlxManager__factory);

    positionManager = await connect(PositionManager__factory);
    await positionManager.setInLegacyMode(true);
    await router.addPlugin(positionManager.address);

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed));

    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(3000));
    await vault.setTokenConfig(...getEthConfig(eth, ethPriceFeed));

    await dai.mint(alice.address, toWei(1000000, 18));
    await dai.connect(alice).approve(router.address, toWei(1000000, 18));
    await router
      .connect(alice)
      .swap([dai.address, usdg.address], toWei(500000, 18), toWei(29000, 18), alice.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    await dai.mint(bob.address, toWei(500000, 18));
    await dai.connect(bob).approve(router.address, toWei(3000000, 18));
    await router.connect(bob).approvePlugin(positionManager.address);

    await dai.mint(user.address, toWei(500000, 18));
    await dai.connect(user).approve(router.address, toWei(3000000, 18));
    await router.connect(user).approvePlugin(positionManager.address);

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
    await timelock.setContractHandler(positionManager.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);
  });

  it("PositionManager and XlxManager init with shortsTracker", async () => {
    const [positionManagerShortTracker, xlxManagerShortTracker, avgeragePrice, size] = await Promise.all([
      positionManager.shortsTracker(),
      xlxManager.shortsTracker(),
      shortsTracker.globalShortAveragePrices(btc.address),
      vault.globalShortSizes(btc.address),
    ]);
    expect(positionManagerShortTracker, "positionManager shortsTracker").eq(shortsTracker.address);
    expect(xlxManagerShortTracker, "xlxManager shortsTracker").eq(shortsTracker.address);
    expect(avgeragePrice, "averagePrice").to.be.equal(0);
    expect(size, "size").to.be.equal(0);
  });

  it("does not update shorts data if isGlobalShortDataReady == false", async () => {
    expect(await shortsTracker.connect(deployer).isGlobalShortDataReady()).to.be.false;

    let averagePrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(averagePrice).to.be.equal(0);

    await positionManager
      .connect(alice)
      .increasePosition([dai.address], btc.address, toWei(100, 18), 0, toUsd(1000), false, toWei(60000));
    averagePrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(averagePrice).to.be.equal(0);

    await positionManager
      .connect(alice)
      .decreasePosition(dai.address, btc.address, 0, toUsd(1000), false, alice.address, toUsd(60000));
    averagePrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(averagePrice).to.be.equal(0);
  });

  it("updates global short sizes as Vault does", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);
    expect(await vault.globalShortSizes(btc.address)).to.be.equal(0);
    expect(await vault.globalShortSizes(btc.address)).to.be.equal(0);

    await positionManager
      .connect(alice)
      .increasePosition([dai.address], btc.address, toWei(100, 18), 0, toUsd(1000), false, toUsd(60000));
    expect(await vault.globalShortSizes(btc.address)).to.be.equal(await vault.globalShortSizes(btc.address));
    expect(await vault.globalShortSizes(btc.address)).to.be.equal(toUsd(1000));

    await positionManager
      .connect(alice)
      .decreasePosition(dai.address, btc.address, 0, toUsd(1000), false, alice.address, toUsd(60000));
    expect(await vault.globalShortSizes(btc.address)).to.be.equal(await vault.globalShortSizes(btc.address));
    expect(await vault.globalShortSizes(btc.address)).to.be.equal(0);
  });

  it("updates global short average prices on position increases as Vault does", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);
    expect(await shortsTracker.globalShortAveragePrices(btc.address)).to.be.equal(0);

    await positionManager
      .connect(alice)
      .increasePosition([dai.address], btc.address, toWei(100, 18), 0, toUsd(1000), false, toUsd(60000));
    expect(await shortsTracker.globalShortAveragePrices(btc.address)).to.be.equal(
      await vault.globalShortAveragePrices(btc.address),
    );

    await positionManager
      .connect(alice)
      .increasePosition([dai.address], btc.address, toWei(100, 18), 0, toUsd(1000), false, toUsd(60000));
    expect(await shortsTracker.globalShortAveragePrices(btc.address)).to.be.equal(
      await vault.globalShortAveragePrices(btc.address),
    );
  });
});
