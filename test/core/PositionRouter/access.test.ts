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
  Timelock,
  PositionRouter,
  ReferralStorage,
  FastPriceFeed,
  FastPriceEvents,
  ShortsTracker,
  Timelock__factory,
  ShortsTracker__factory,
  PositionRouter__factory,
  ReferralStorage__factory,
  Reader__factory,
  FastPriceEvents__factory,
  FastPriceFeed__factory,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";
import { getBtcConfig, getDaiConfig, getEthConfig } from "../Vault/helper";
import { constants, BigNumber, BigNumberish } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;

const depositFee = 30;
const minExecutionFee = BigNumber.from("17000000000000000");
let vault: Vault;
let timelock: Timelock;
let usdg: USDG;
let router: Router;
let positionRouter: PositionRouter;
let referralStorage: ReferralStorage;
let btc: Token;
let btcPriceFeed: PriceFeed;
let eth: Token;
let ethPriceFeed: PriceFeed;
let dai: Token;
let daiPriceFeed: PriceFeed;
let distributor: TimeDistributor;
let yieldTracker: YieldTracker;
let fastPriceFeed: FastPriceFeed;
let fastPriceEvents: FastPriceEvents;
let shortsTracker: ShortsTracker;

let alice: SignerWithAddress;
let bob: SignerWithAddress;
let deployer: SignerWithAddress;
let positionKeeper: SignerWithAddress;
let minter: SignerWithAddress;
let tokenManager: SignerWithAddress;
let signer0: SignerWithAddress;
let signer1: SignerWithAddress;
let updater0: SignerWithAddress;
let updater1: SignerWithAddress;

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

describe.only("PositionManager - access", () => {
  before(async () => {
    const scaffold = await setup();

    alice = scaffold.accounts.alice;
    bob = scaffold.accounts.bob;
    deployer = scaffold.accounts.deployer;
    positionKeeper = scaffold.accounts.signer;

    minter = scaffold.users[0];
    tokenManager = scaffold.users[1];
    signer0 = scaffold.users[2];
    signer1 = scaffold.users[3];
    updater0 = scaffold.users[4];
    updater1 = scaffold.users[5];

    const { connect } = scaffold.ship;

    eth = (await connect("WETH")) as Token;
    ethPriceFeed = (await connect("EthPriceFeed")) as PriceFeed;

    btc = (await connect("WBTC")) as Token;
    btcPriceFeed = (await connect("BtcPriceFeed")) as PriceFeed;

    dai = (await connect("DAI")) as Token;
    daiPriceFeed = (await connect("DaiPriceFeed")) as PriceFeed;

    vault = await connect(Vault__factory);
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
          10, // marginFeeBasisPoints 0.1%
          500, // maxMarginFeeBasisPoints 5%
        ],
      })
    ).contract;

    usdg = await connect(USDG__factory);
    router = await connect(Router__factory);

    shortsTracker = await connect(ShortsTracker__factory);
    await shortsTracker.setIsGlobalShortDataReady(true);

    positionRouter = await connect(PositionRouter__factory);
    await shortsTracker.setHandler(positionRouter.address, true);

    referralStorage = (await ship.deploy(ReferralStorage__factory)).contract;
    const vaultPriceFeed = await connect(VaultPriceFeed__factory);
    await positionRouter.setReferralStorage(referralStorage.address);
    await referralStorage.setHandler(positionRouter.address, true);

    distributor = await connect(TimeDistributor__factory);
    yieldTracker = await connect(YieldTracker__factory);

    await eth.mint(distributor.address, 5000);
    await usdg.setYieldTrackers([yieldTracker.address]);

    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false);
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false);
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false);

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed));

    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(3000));
    await vault.setTokenConfig(...getEthConfig(eth, ethPriceFeed));

    await vault.setIsLeverageEnabled(false);
    await vault.setGov(timelock.address);

    fastPriceEvents = (await ship.deploy(FastPriceEvents__factory)).contract;
    fastPriceFeed = (
      await ship.deploy(FastPriceFeed__factory, {
        args: [
          5 * 60, // _priceDuration
          120 * 60, // _maxPriceUpdateDelay
          2, // _minBlockInterval
          250, // _maxDeviationBasisPoints
          fastPriceEvents.address, // _fastPriceEvents
          tokenManager.address, // _tokenManager
          positionRouter.address, // _positionRouter
        ],
      })
    ).contract;

    await fastPriceFeed.initialize(
      2,
      [signer0.address, signer1.address],
      [updater0.address, updater1.address],
    );
    await fastPriceEvents.setIsPriceFeed(fastPriceFeed.address, true);

    await fastPriceFeed.setVaultPriceFeed(vaultPriceFeed.address);
    await vaultPriceFeed.setSecondaryPriceFeed(fastPriceFeed.address);
  });

  it("inits", async () => {
    expect(await positionRouter.vault()).eq(vault.address);
    expect(await positionRouter.router()).eq(router.address);
    expect(await positionRouter.weth()).eq(eth.address);
    expect(await positionRouter.depositFee()).eq(depositFee);
    expect(await positionRouter.minExecutionFee()).eq(minExecutionFee);
    expect(await positionRouter.admin()).eq(deployer.address);
    expect(await positionRouter.gov()).eq(deployer.address);
  });

  it("setAdmin", async () => {
    await expect(positionRouter.connect(alice).setAdmin(bob.address)).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await positionRouter.admin()).eq(deployer.address);
    await positionRouter.connect(deployer).setAdmin(bob.address);
    expect(await positionRouter.admin()).eq(bob.address);

    await positionRouter.connect(deployer).setAdmin(deployer.address);
  });

  it("setDepositFee", async () => {
    await expect(positionRouter.connect(alice).setDepositFee(25)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    expect(await positionRouter.depositFee()).eq(depositFee);
    await positionRouter.connect(deployer).setDepositFee(25);
    expect(await positionRouter.depositFee()).eq(25);

    await positionRouter.connect(deployer).setDepositFee(depositFee);
  });

  it("setIncreasePositionBufferBps", async () => {
    await expect(positionRouter.connect(alice).setIncreasePositionBufferBps(200)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    expect(await positionRouter.increasePositionBufferBps()).eq(100);
    await positionRouter.connect(deployer).setIncreasePositionBufferBps(200);
    expect(await positionRouter.increasePositionBufferBps()).eq(200);

    await positionRouter.connect(deployer).setIncreasePositionBufferBps(100);
  });

  it("setReferralStorage", async () => {
    await expect(positionRouter.connect(alice).setReferralStorage(bob.address)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    expect(await positionRouter.referralStorage()).eq(referralStorage.address);
    await positionRouter.connect(deployer).setReferralStorage(bob.address);
    expect(await positionRouter.referralStorage()).eq(bob.address);

    await positionRouter.connect(deployer).setReferralStorage(referralStorage.address);
  });

  it("setMaxGlobalSizes", async () => {
    const tokens = [btc.address, eth.address];
    const maxGlobalLongSizes = [20, 15];
    const maxGlobalShortSizes = [12, 8];

    await expect(
      positionRouter.connect(alice).setMaxGlobalSizes(tokens, maxGlobalLongSizes, maxGlobalShortSizes),
    ).to.be.revertedWith("BasePositionManager: forbidden");

    expect(await positionRouter.maxGlobalLongSizes(btc.address)).eq(0);
    expect(await positionRouter.maxGlobalLongSizes(eth.address)).eq(0);

    expect(await positionRouter.maxGlobalShortSizes(btc.address)).eq(0);
    expect(await positionRouter.maxGlobalShortSizes(eth.address)).eq(0);

    await positionRouter.connect(deployer).setMaxGlobalSizes(tokens, maxGlobalLongSizes, maxGlobalShortSizes);

    expect(await positionRouter.maxGlobalLongSizes(btc.address)).eq(20);
    expect(await positionRouter.maxGlobalLongSizes(eth.address)).eq(15);

    expect(await positionRouter.maxGlobalShortSizes(btc.address)).eq(12);
    expect(await positionRouter.maxGlobalShortSizes(eth.address)).eq(8);
  });

  it("withdrawFees", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await eth.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(eth.address, bob.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    let params: [
      string[],
      string,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      boolean,
      BigNumberish,
      BigNumberish,
      string,
      string,
    ] = [
      [dai.address, eth.address], // _path
      eth.address, // _indexToken
      toWei(600, 18), // _amountIn
      toWei(1, 17), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
      minExecutionFee,
      referralCode,
      constants.AddressZero,
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(alice).approvePlugin(positionRouter.address);

    await dai.mint(alice.address, toWei(600, 18));
    await dai.connect(alice).approve(router.address, toWei(600, 18));

    let key = await positionRouter.getRequestKey(alice.address, 1);

    const executionFeeReceiver = ship.users[9];
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter.connect(alice).createIncreasePosition(...params, { value: minExecutionFee });
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);
    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(minExecutionFee);

    params = [
      [dai.address, eth.address], // _path
      eth.address, // _indexToken
      toWei(600, 18), // _amountIn
      toWei(1, 18), // _minOut
      toUsd(0), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
      minExecutionFee,
      referralCode,
      constants.AddressZero,
    ];

    await dai.mint(alice.address, toWei(600, 18));
    await dai.connect(alice).approve(router.address, toWei(600, 18));

    await positionRouter.connect(alice).createIncreasePosition(...params, { value: minExecutionFee });
    key = await positionRouter.getRequestKey(alice.address, 2);

    expect(await positionRouter.feeReserves(eth.address)).eq(0);
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);
    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(8000);
    expect(await positionRouter.feeReserves(dai.address)).eq(0);
    expect(await positionRouter.feeReserves(eth.address)).eq("9970000000000000"); // 0.00997

    await expect(
      positionRouter.connect(signer0).withdrawFees(dai.address, signer1.address),
    ).to.be.revertedWith("BasePositionManager: forbidden");

    await positionRouter.setAdmin(signer0.address);

    expect(await dai.balanceOf(signer1.address)).eq(0);
    expect(await eth.balanceOf(signer1.address)).eq(0);

    await positionRouter.connect(signer0).withdrawFees(dai.address, signer1.address);

    expect(await positionRouter.feeReserves(dai.address)).eq(0);
    expect(await positionRouter.feeReserves(eth.address)).eq("9970000000000000"); // 0.00997

    expect(await dai.balanceOf(signer1.address)).eq(0);
    expect(await eth.balanceOf(signer1.address)).eq(0);

    await positionRouter.connect(signer0).withdrawFees(eth.address, signer1.address);

    expect(await dai.balanceOf(signer1.address)).eq(0);
    expect(await eth.balanceOf(signer1.address)).eq("9970000000000000");

    expect(await positionRouter.feeReserves(dai.address)).eq(0);
    expect(await positionRouter.feeReserves(eth.address)).eq(0);
  });
});
