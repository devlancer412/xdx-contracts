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

describe("PositionManager - increase position with eth and swap", () => {
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
    await timelock.setContractHandler(positionManager.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);
  });

  it("increasePositionETH with swap", async () => {
    await positionManager.setInLegacyMode(true);
    await positionManager
      .connect(alice)
      .increasePositionETH([eth.address, btc.address], btc.address, 0, toUsd(20000), true, toUsd(60000), {
        value: toWei(1),
      });

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(20000)); // size
    expect(position[1]).eq("2971000000000000000000000000000000"); // collateral, 2971, 3000 - 2971 => 29, 9 fee for swap, 20 fee for size delta

    await positionManager
      .connect(alice)
      .increasePositionETH([eth.address, btc.address], btc.address, 0, 0, true, toUsd(60000), {
        value: toWei(1),
      });

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(20000)); // size
    expect(position[1]).eq("5947045000000000000000000000000000"); // collateral, 5947.045, 5947.045 - 2971 => 2976.045, 3000 - 2976.045 => 23.955, ~15 + 9 fee for swap
  });

  it("increasePosition and increasePositionETH to short", async () => {
    await dai.mint(alice.address, toWei(200, 18));
    await dai.connect(alice).approve(router.address, toWei(200, 18));

    await timelock.setShouldToggleIsLeverageEnabled(true);
    await positionManager.setInLegacyMode(true);
    await positionManager
      .connect(alice)
      .increasePositionETH([eth.address, dai.address], btc.address, 0, toUsd(3000), false, 0, {
        value: toWei(1, 18),
      });

    let position = await vault.getPosition(alice.address, dai.address, btc.address, false);
    expect(position[0]).eq(toUsd(3000));
    expect(position[1]).eq("2988000000000000000000000000000000");

    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(alice).approve(router.address, toWei(1, 8));
    await positionManager
      .connect(alice)
      .increasePosition([btc.address, dai.address], eth.address, "500000", 0, toUsd(3000), false, 0);

    position = await vault.getPosition(alice.address, dai.address, eth.address, false);
    expect(position[0]).eq(toUsd(3000));
    expect(position[1]).eq("296100000000000000000000000000000");
  });

  it("decreasePositionAndSwap - ETH Long", async () => {
    await dai.mint(alice.address, toWei(20000, 18));
    await dai.connect(alice).approve(router.address, toWei(20000, 18));

    await eth.deposit({ value: toWei(10, 18) });

    // ETH Long
    await positionManager
      .connect(alice)
      .increasePosition(
        [dai.address, eth.address],
        eth.address,
        toWei(200, 18),
        0,
        toUsd(2000),
        true,
        toUsd(60000),
      );

    let position = await vault.getPosition(alice.address, eth.address, eth.address, true);
    expect(position[0]).eq(toUsd(2000)); // size

    const params: [string[], string, BigNumberish, BigNumberish, boolean, string, number] = [
      [eth.address, dai.address], // path
      eth.address, // indexToken
      position[1], // collateralDelta
      position[0], // sizeDelta
      true, // isLong
      alice.address, // reciever
      0, // price
    ];

    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager.connect(alice).decreasePositionAndSwap(...params, toWei(200, 18)),
    ).to.be.revertedWith("PositionManager: forbidden");
    await positionManager.setInLegacyMode(true);

    // too high minOut
    await expect(
      positionManager.connect(alice).decreasePositionAndSwap(...params, toWei(200, 18)),
    ).to.be.revertedWith("BasePositionManager: insufficient amountOut");

    // invalid path[0] == path[1]
    params[0] = [eth.address, eth.address];
    await expect(positionManager.connect(alice).decreasePositionAndSwap(...params, 0)).to.be.revertedWith(
      "Vault: invalid tokens",
    );

    // path.length > 2
    params[0] = [eth.address, dai.address, eth.address];
    await expect(positionManager.connect(alice).decreasePositionAndSwap(...params, 0)).to.be.revertedWith(
      "PositionManager: invalid _path.length",
    );

    const daiBalance = await dai.balanceOf(alice.address);
    params[0] = [eth.address, dai.address];
    await positionManager.connect(alice).decreasePositionAndSwap(...params, 0);
    expect(await dai.balanceOf(alice.address)).to.be.equal(daiBalance.add("194813799999999996012"));

    position = await vault.getPosition(alice.address, eth.address, eth.address, true);
    expect(position[0]).eq(0); // size
  });

  it("decreasePositionAndSwap - BTC Short", async () => {
    await positionManager
      .connect(alice)
      .increasePosition([dai.address], btc.address, toWei(200, 18), 0, toUsd(2000), false, toUsd(60000));

    let position = await vault.getPosition(alice.address, dai.address, btc.address, false);
    expect(position[0]).eq(toUsd(5000)); // size

    const params: [string[], string, BigNumberish, BigNumberish, boolean, string, BigNumberish] = [
      [dai.address, eth.address], // path
      btc.address, // indexToken
      position[1], // collateralDelta
      position[0], // sizeDelta
      false, // isLong
      alice.address, // reciever
      toUsd(60000), // price
    ];
    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager.connect(alice).decreasePositionAndSwapETH(...params, toWei(200, 18)),
    ).to.be.revertedWith("PositionManager: forbidden");
    await positionManager.setInLegacyMode(true);

    await expect(
      positionManager.connect(alice).decreasePositionAndSwapETH(...params, toWei(200, 18)),
    ).to.be.revertedWith("BasePositionManager: insufficient amountOut");

    params[0] = [dai.address, dai.address];
    await expect(positionManager.connect(alice).decreasePositionAndSwapETH(...params, 0)).to.be.revertedWith(
      "PositionManager: invalid _path",
    );

    params[0] = [dai.address, btc.address, eth.address];
    await expect(positionManager.connect(alice).decreasePositionAndSwapETH(...params, 0)).to.be.revertedWith(
      "PositionManager: invalid _path.length",
    );

    params[0] = [dai.address, eth.address];
    const ethBalance = await ship.provider.getBalance(alice.address);
    await positionManager.connect(alice).decreasePositionAndSwapETH(...params, 0);
    expect((await ship.provider.getBalance(alice.address)).gt(ethBalance)).to.be.true;

    position = await vault.getPosition(alice.address, dai.address, btc.address, false);
    expect(position[0]).eq(0); // size
  });

  it("deposit collateral for shorts", async () => {
    await dai.mint(alice.address, toWei(200, 18));
    await dai.connect(alice).approve(router.address, toWei(200, 18));

    await positionManager.setInLegacyMode(true);

    await positionManager
      .connect(alice)
      .increasePositionETH([eth.address, dai.address], btc.address, 0, toUsd(3000), false, 0, {
        value: toWei(1, 18),
      });

    const position = await vault.getPosition(alice.address, dai.address, btc.address, false);
    expect(position[0]).eq(toUsd(3000));
    expect(position[1]).eq("2988000000000000000000000000000000"); // 2988 = 3000 - 12
  });
});
