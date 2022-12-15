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
  PositionManager__factory,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship, toChainlinkPrice, toWei } from "../../../utils";
import { getBtcConfig, getDaiConfig, getEthConfig } from "../Vault/helper";

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

let alice: SignerWithAddress;
let bob: SignerWithAddress;
let deployer: SignerWithAddress;

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

describe("PositionManager - access", () => {
  before(async () => {
    const scaffold = await setup();

    alice = scaffold.accounts.alice;
    bob = scaffold.accounts.bob;
    deployer = scaffold.accounts.deployer;

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
  });

  it("inits", async () => {
    expect(await positionManager.router(), "router").eq(router.address);
    expect(await positionManager.vault(), "vault").eq(vault.address);
    expect(await positionManager.weth(), "weth").eq(eth.address);
    expect(await positionManager.depositFee()).eq(50);
    expect(await positionManager.gov(), "gov").eq(deployer.address);
  });

  it("setDepositFee", async () => {
    await expect(positionManager.connect(alice).setDepositFee(10)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    expect(await positionManager.depositFee()).eq(50);
    await positionManager.connect(deployer).setDepositFee(10);
    expect(await positionManager.depositFee()).eq(10);

    await positionManager.connect(deployer).setDepositFee(50);
  });

  it("approve", async () => {
    await expect(positionManager.connect(alice).approve(eth.address, bob.address, 10)).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await eth.allowance(positionManager.address, bob.address)).eq(0);
    await positionManager.connect(deployer).approve(eth.address, bob.address, 10);
    expect(await eth.allowance(positionManager.address, bob.address)).eq(10);
  });

  it("setOrderKeeper", async () => {
    await expect(positionManager.connect(alice).setOrderKeeper(bob.address, true)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    expect(await positionManager.isOrderKeeper(bob.address)).eq(false);
    await positionManager.connect(deployer).setOrderKeeper(bob.address, true);
    expect(await positionManager.isOrderKeeper(bob.address)).eq(true);
  });

  it("setLiquidator", async () => {
    await expect(positionManager.connect(alice).setLiquidator(bob.address, true)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    expect(await positionManager.isLiquidator(bob.address)).eq(false);
    await positionManager.connect(deployer).setLiquidator(bob.address, true);
    expect(await positionManager.isLiquidator(bob.address)).eq(true);
  });

  it("setPartner", async () => {
    await expect(positionManager.connect(alice).setPartner(bob.address, true)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    expect(await positionManager.isPartner(bob.address)).eq(false);
    await positionManager.connect(deployer).setPartner(bob.address, true);
    expect(await positionManager.isPartner(bob.address)).eq(true);
  });

  it("setInLegacyMode", async () => {
    await expect(positionManager.connect(alice).setInLegacyMode(true)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    expect(await positionManager.inLegacyMode()).eq(false);
    await positionManager.connect(deployer).setInLegacyMode(true);
    expect(await positionManager.inLegacyMode()).eq(true);

    await positionManager.connect(deployer).setInLegacyMode(false);
  });

  it("setShouldValidateIncreaseOrder", async () => {
    await expect(positionManager.connect(alice).setShouldValidateIncreaseOrder(false)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    expect(await positionManager.shouldValidateIncreaseOrder()).eq(true);
    await positionManager.connect(deployer).setShouldValidateIncreaseOrder(false);
    expect(await positionManager.shouldValidateIncreaseOrder()).eq(false);
  });
});
