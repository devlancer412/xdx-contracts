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

describe("PositionManager - position with eth", () => {
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
  });

  it("timelock", async () => {
    await positionManager.setInLegacyMode(true);
    await expect(
      positionManager
        .connect(alice)
        .increasePositionETH([eth.address], eth.address, 0, 0, true, toUsd(100000), {
          value: toWei(1),
        }),
    ).to.be.revertedWith("Timelock: forbidden");
  });

  it("path[0] should always be weth", async () => {
    await expect(
      positionManager
        .connect(alice)
        .increasePositionETH([btc.address], eth.address, 0, 0, true, toUsd(100000), {
          value: toWei(1),
        }),
    ).to.be.revertedWith("PositionManager: invalid _path");
  });

  it("path length should be 1 or 2", async () => {
    await expect(
      positionManager
        .connect(alice)
        .increasePositionETH(
          [eth.address, dai.address, btc.address],
          eth.address,
          0,
          0,
          true,
          toUsd(100000),
          { value: toWei(1) },
        ),
    ).to.be.revertedWith("PositionManager: invalid _path.length");
  });

  it("too low desired price", async () => {
    await timelock.setContractHandler(positionManager.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    await dai.mint(alice.address, toWei(2, 18));
    await dai.connect(alice).approve(router.address, toWei(2, 18));

    await expect(
      positionManager
        .connect(alice)
        .increasePositionETH([eth.address], eth.address, 0, toUsd(20000), true, toUsd(200), {
          value: toWei(1),
        }),
    ).to.be.revertedWith("BasePositionManager: mark price higher than limit");
  });

  it("increase position with eth", async () => {
    await positionManager
      .connect(alice)
      .increasePositionETH([eth.address], eth.address, 0, toUsd(20000), true, toUsd(100000), {
        value: toWei(1),
      });
    const position = await vault.getPosition(alice.address, eth.address, eth.address, true);
    expect(position[0]).eq(toUsd(20000));
    expect(position[1]).eq("2980000000000000000000000000000000");
  });

  it("deposit - should deduct extra fee", async () => {
    await positionManager
      .connect(alice)
      .increasePositionETH([eth.address], eth.address, 0, 0, true, toUsd(60000), {
        value: toWei(1),
      });
    const position = await vault.getPosition(alice.address, eth.address, eth.address, true);
    expect(position[0]).eq(toUsd(20000)); // size
    expect(position[1]).eq("5965000000000000000000000000000000"); // collateral, 2980 + 3000 - 15 (3000 * 0.5%) = 5965

    expect(await eth.balanceOf(positionManager.address)).eq(toWei(5, 15)); // 1 * 0.5%
  });

  it("leverage is decreased because of big amount of collateral - should deduct extra fee", async () => {
    await positionManager
      .connect(alice)
      .increasePositionETH([eth.address], eth.address, 0, toUsd(3000), true, toUsd(60000), {
        value: toWei(1),
      });
    const position = await vault.getPosition(alice.address, eth.address, eth.address, true);
    expect(position[0]).eq(toUsd(23000)); // size
    expect(position[1]).eq("8947000000000000000000000000000000"); // collateral, 5965 + 3000 - 3 - 15 = 8947
  });

  it("regular position increase, no extra fee applied", async () => {
    await positionManager
      .connect(alice)
      .increasePositionETH([eth.address], eth.address, 0, toUsd(10000), true, toUsd(60000), {
        value: toWei(1),
      });
    const position = await vault.getPosition(alice.address, eth.address, eth.address, true);
    expect(position[0]).eq(toUsd(33000)); // size
    expect(position[1]).eq("11937000000000000000000000000000000"); // collateral, 8947 + 3000 - 10 = 11937
  });

  it("decrease position with eth", async () => {
    let position = await vault.getPosition(alice.address, eth.address, eth.address, true);
    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager
        .connect(alice)
        .decreasePositionETH(eth.address, eth.address, position[1], position[0], true, alice.address, 0),
    ).to.be.revertedWith("PositionManager: forbidden");
    await positionManager.setInLegacyMode(true);

    const balanceBefore = await ship.provider.getBalance(alice.address);
    await positionManager
      .connect(alice)
      .decreasePositionETH(eth.address, eth.address, position[1], position[0], true, alice.address, 0);
    const balanceAfter = await ship.provider.getBalance(alice.address);
    expect(balanceAfter.gt(balanceBefore));
    position = await vault.getPosition(alice.address, eth.address, eth.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager
        .connect(alice)
        .increasePositionETH([eth.address], eth.address, 0, toUsd(1000), true, toUsd(60000), {
          value: toWei(1),
        }),
    ).to.be.revertedWith("PositionManager: forbidden");
  });

  it("partners should have access in non-legacy mode", async () => {
    expect(await positionManager.isPartner(alice.address)).to.be.false;
    await positionManager.setPartner(alice.address, true);
    expect(await positionManager.isPartner(alice.address)).to.be.true;
    await positionManager
      .connect(alice)
      .increasePositionETH([eth.address], eth.address, 0, toUsd(10000), true, toUsd(60000), {
        value: toWei(1),
      });
  });
});
