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
import { constants } from "ethers";

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

let alice: SignerWithAddress;
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

describe("PositionManager - increasePosition and decreasePosition", () => {
  before(async () => {
    const scaffold = await setup();

    alice = scaffold.accounts.alice;
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

    await vault.setInManagerMode(true);
  });

  it("Partnership test", async () => {
    await expect(
      positionManager
        .connect(alice)
        .increasePosition([btc.address], btc.address, toWei(1, 7), 0, 0, true, toUsd(100000)),
    ).to.be.revertedWith("PositionManager: forbidden");

    await vault.setGov(timelock.address);
    await router.addPlugin(positionManager.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    await btc.connect(alice).approve(router.address, toWei(1, 8));
    await btc.mint(alice.address, toWei(3, 8));

    await positionManager.setInLegacyMode(true);
    await expect(
      positionManager
        .connect(alice)
        .increasePosition([btc.address], btc.address, toWei(1, 7), 0, 0, true, toUsd(100000)),
    ).to.be.revertedWith("Timelock: forbidden");
  });

  it("path length should be 1 or 2", async () => {
    await expect(
      positionManager
        .connect(alice)
        .increasePosition(
          [btc.address, eth.address, dai.address],
          btc.address,
          toWei(1, 7),
          0,
          0,
          true,
          toUsd(100000),
        ),
    ).to.be.revertedWith("PositionManager: invalid _path.length");

    await timelock.setContractHandler(positionManager.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    await dai.mint(alice.address, toWei(20000, 18));
    await dai.connect(alice).approve(router.address, toWei(20000, 18));
  });

  it("too low desired price", async () => {
    await expect(
      positionManager
        .connect(alice)
        .increasePosition(
          [dai.address, btc.address],
          btc.address,
          toWei(200, 18),
          "332333",
          toUsd(2000),
          true,
          toUsd(50000),
        ),
    ).to.be.revertedWith("BasePositionManager: mark price higher than limit");
  });

  it("too big minOut", async () => {
    await expect(
      positionManager
        .connect(alice)
        .increasePosition(
          [dai.address, btc.address],
          btc.address,
          toWei(200, 18),
          "1332333",
          toUsd(2000),
          true,
          toUsd(60000),
        ),
    ).to.be.revertedWith("BasePositionManager: insufficient amountOut");
  });

  it("increasePosition", async () => {
    await positionManager
      .connect(alice)
      .increasePosition(
        [dai.address, btc.address],
        btc.address,
        toWei(200, 18),
        "332333",
        toUsd(2000),
        true,
        toUsd(60000),
      );

    const position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(2000)); // size
    expect(position[1]).eq("197399800000000000000000000000000"); // collateral, 197.3998
    expect(position[2]).eq(toUsd(60000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("3333333"); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit)
  });

  it("deposit - should deduct extra fee", async () => {
    await positionManager
      .connect(alice)
      .increasePosition([btc.address], btc.address, "500000", 0, 0, true, toUsd(60000));

    const position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(2000)); // size
    expect(position[1]).eq("495899800000000000000000000000000"); // collateral, 495.8998, 495.8998 - 197.3998 => 298.5, 1.5 for fees
    expect(position[2]).eq(toUsd(60000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("3333333"); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    expect(await btc.balanceOf(positionManager.address)).eq(2500); // 2500 / (10**8) * 60000 => 1.5
    await positionManager.approve(btc.address, alice.address, 5000);
    expect(await btc.balanceOf(user.address)).eq(0);
    await btc.connect(alice).transferFrom(positionManager.address, user.address, 2500);
    expect(await btc.balanceOf(user.address)).eq(2500);
  });

  it("leverage is decreased because of big amount of collateral - should deduct extra fee", async () => {
    await positionManager
      .connect(alice)
      .increasePosition([btc.address], btc.address, "500000", 0, toUsd(300), true, toUsd(100000));

    const position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(2300)); // size
    expect(position[1]).eq("794099800000000000000000000000000"); // collateral, 794.0998, 794.0998 - 495.8998 => 298.2, 1.5 for collateral fee, 0.3 for size delta fee
  });

  it("regular position increase, no extra fee applied", async () => {
    await positionManager
      .connect(alice)
      .increasePosition([btc.address], btc.address, "500000", 0, toUsd(1000), true, toUsd(100000));
    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(3300)); // size
    expect(position[1]).eq("1093099800000000000000000000000000"); // collateral, 1093.0998, 1093.0998 - 794.0998 => 299, 1.0 for size delta fee

    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager
        .connect(alice)
        .decreasePosition(btc.address, btc.address, position[1], position[0], true, alice.address, 0),
    ).to.be.revertedWith("PositionManager: forbidden");
    await positionManager.setInLegacyMode(true);

    expect(await btc.balanceOf(alice.address)).to.be.equal("298500000");
    await positionManager
      .connect(alice)
      .decreasePosition(btc.address, btc.address, position[1], position[0], true, alice.address, 0);
    expect(await btc.balanceOf(alice.address)).to.be.equal("300316333");
    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral

    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager
        .connect(alice)
        .increasePosition(
          [dai.address, btc.address],
          btc.address,
          toWei(200, 18),
          "332333",
          toUsd(2000),
          true,
          toUsd(60000),
        ),
    ).to.be.revertedWith("PositionManager: forbidden");
  });

  it("partners should have access in non-legacy mode", async () => {
    expect(await positionManager.isPartner(alice.address)).to.be.false;
    await positionManager.setPartner(alice.address, true);
    expect(await positionManager.isPartner(alice.address)).to.be.true;
    await positionManager
      .connect(alice)
      .increasePosition(
        [dai.address, btc.address],
        btc.address,
        toWei(200, 18),
        "332333",
        toUsd(2000),
        true,
        toUsd(60000),
      );
  });
});
