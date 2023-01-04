import {
  Timelock,
  XDX,
  EsXDX,
  MintableBaseToken,
  RewardTracker,
  RewardDistributor,
  RewardRouterV2,
  Vault,
  XLX,
  XlxManager,
  USDG,
  Token,
  Vester,
  TokenManager,
  StakedXlx,
  XlxBalance,
  EsXdxBatchSender__factory,
  RewardRouterV2__factory,
  Vault__factory,
  XLX__factory,
  XDX__factory,
  XlxManager__factory,
  USDG__factory,
  EsXDX__factory,
  Timelock__factory,
  TokenManager__factory,
  StakedXlx__factory,
  XlxBalance__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { advanceTimeAndBlock, reportGasUsed, Ship, toWei } from "../../utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Wallet } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let xlx: XLX;
let xdx: XDX;
let xlxManager: XlxManager;
let usdg: USDG;
let esXdx: EsXDX;
let bnXdx: MintableBaseToken;
let stakedXdxTracker: RewardTracker;
let stakedXdxDistributor: RewardDistributor;
let bonusXdxTracker: RewardTracker;
let feeXdxTracker: RewardTracker;
let feeXdxDistributor: RewardDistributor;
let stakedXlxTracker: RewardTracker;
let stakedXlxDistributor: RewardDistributor;
let feeXlxTracker: RewardTracker;
let feeXlxDistributor: RewardDistributor;
let xdxVester: Vester;
let xlxVester: Vester;
let rewardRouter: RewardRouterV2;
let timelock: Timelock;
let tokenManager: TokenManager;
let stakedXlx: StakedXlx;
let xlxBalance: XlxBalance;

let avax: Token;

let deployer: SignerWithAddress;
let signer1: SignerWithAddress;
let signer2: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let user3: SignerWithAddress;
let user4: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture([
    "tokens",
    "vault",
    "vaultPriceFeed",
    "xlx",
    "xdx",
    "xlxManager",
    "usdg",
    "esXdx",
    "bnXdx",
    "stakedXdxTracker",
    "stakedXdxDistributor",
    "bonusXdxTracker",
    "feeXdxTracker",
    "feeXdxDistributor",
    "stakedXlxTracker",
    "stakedXlxDistributor",
    "feeXlxTracker",
    "feeXlxDistributor",
    "xdxVester",
    "xlxVester",
    "rewardRouter",
    "timelock",
    "tokenManager",
    "stakedXlx",
    "xlxBalance",
  ]);

  return {
    ship,
    accounts,
    users,
  };
});

// Tier0 (5% discount, 5% rebate) = Tier {totalRebate = 1000, defaultTradersDiscountShare = 5000}
// Tier1 (12% discount, 8% rebate) = Tier {totalRebate = 2000, defaultTradersDiscountShare = 6000}
// Tier2 (12% discount, 15% rebate) = Tier {totalRebate = 2700, defaultTradersDiscountShare = 4444}
// for the last tier extra EsXDX incentives will be handled off-chain
describe("RewardRouter", () => {
  beforeEach(async () => {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    signer1 = accounts.signer1;
    signer2 = accounts.signer2;
    user0 = users[0];
    user1 = users[1];
    user2 = users[2];
    user3 = users[3];
    user4 = users[4];

    avax = (await ship.connect("avax")) as Token;

    vault = await ship.connect(Vault__factory);
    xlx = await ship.connect(XLX__factory);
    xdx = await ship.connect(XDX__factory);
    xlxManager = await ship.connect(XlxManager__factory);
    usdg = await ship.connect(USDG__factory);
    esXdx = await ship.connect(EsXDX__factory);
    rewardRouter = await ship.connect(RewardRouterV2__factory);
    timelock = await ship.connect(Timelock__factory);
    tokenManager = await ship.connect(TokenManager__factory);
    stakedXlx = await ship.connect(StakedXlx__factory);
    xlxBalance = await ship.connect(XlxBalance__factory);

    xdxVester = (await ship.connect("XdxVester")) as Vester;
    xlxVester = (await ship.connect("XlxVester")) as Vester;
    bnXdx = (await ship.connect("BN_XDX")) as MintableBaseToken;
    stakedXdxTracker = (await ship.connect("StakedXdxTracker")) as RewardTracker;
    stakedXdxDistributor = (await ship.connect("StakedXdxDistributor")) as RewardDistributor;
    bonusXdxTracker = (await ship.connect("BonusXdxTracker")) as RewardTracker;
    const bonusXdxDistributor = (await ship.connect("BonusXdxDistributor")) as RewardDistributor;
    feeXdxTracker = (await ship.connect("FeeXdxTracker")) as RewardTracker;
    feeXdxDistributor = (await ship.connect("FeeXdxDistributor")) as RewardDistributor;
    stakedXlxTracker = (await ship.connect("StakedXlxTracker")) as RewardTracker;
    stakedXlxDistributor = (await ship.connect("StakedXlxDistributor")) as RewardDistributor;
    feeXlxTracker = (await ship.connect("FeeXlxTracker")) as RewardTracker;
    feeXlxDistributor = (await ship.connect("FeeXlxDistributor")) as RewardDistributor;

    // mint esXdx for distributors
    await esXdx.setMinter(deployer.address, true);
    await esXdx.mint(stakedXdxDistributor.address, toWei(50000, 18));
    await stakedXdxDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esXdx per second
    await esXdx.mint(stakedXlxDistributor.address, toWei(50000, 18));
    await stakedXlxDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esXdx per second

    // mint bnXdx for distributor
    await bnXdx.setMinter(deployer.address, true);
    await bnXdx.mint(bonusXdxDistributor.address, toWei(1500, 18));

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
    await feeXlxTracker.setHandler(xlxVester.address, true);
    await stakedXlxTracker.setHandler(rewardRouter.address, true);

    await esXdx.setHandler(rewardRouter.address, true);
    await bnXdx.setMinter(rewardRouter.address, true);
    await esXdx.setMinter(xdxVester.address, true);
    await esXdx.setMinter(xlxVester.address, true);

    await esXdx.setHandler(deployer.address, true);

    await xdxVester.setHandler(rewardRouter.address, true);
    await xlxVester.setHandler(rewardRouter.address, true);

    await feeXdxTracker.setHandler(xdxVester.address, true);
    await stakedXlxTracker.setHandler(xlxVester.address, true);

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
  });

  it("inits", async () => {
    expect(await rewardRouter.isInitialized()).eq(true);

    expect(await rewardRouter.weth()).eq(avax.address);
    expect(await rewardRouter.xdx()).eq(xdx.address);
    expect(await rewardRouter.esXdx()).eq(esXdx.address);
    expect(await rewardRouter.bnXdx()).eq(bnXdx.address);

    expect(await rewardRouter.xlx()).eq(xlx.address);

    expect(await rewardRouter.stakedXdxTracker()).eq(stakedXdxTracker.address);
    expect(await rewardRouter.bonusXdxTracker()).eq(bonusXdxTracker.address);
    expect(await rewardRouter.feeXdxTracker()).eq(feeXdxTracker.address);

    expect(await rewardRouter.feeXlxTracker()).eq(feeXlxTracker.address);
    expect(await rewardRouter.stakedXlxTracker()).eq(stakedXlxTracker.address);

    expect(await rewardRouter.xlxManager()).eq(xlxManager.address);

    expect(await rewardRouter.xdxVester()).eq(xdxVester.address);
    expect(await rewardRouter.xlxVester()).eq(xlxVester.address);

    await expect(
      rewardRouter.initialize(
        avax.address,
        xdx.address,
        esXdx.address,
        bnXdx.address,
        xlx.address,
        stakedXdxTracker.address,
        bonusXdxTracker.address,
        feeXdxTracker.address,
        feeXlxTracker.address,
        stakedXlxTracker.address,
        xlxManager.address,
        xdxVester.address,
        xlxVester.address,
      ),
    ).to.be.revertedWith("RewardRouter: already initialized");
  });

  it("stakeXdxForAccount, stakeXdx, stakeEsXdx, unstakeXdx, unstakeEsXdx, claimEsXdx, claimFees, compound, batchCompoundForAccounts", async () => {
    await avax.mint(feeXdxDistributor.address, toWei(100, 18));
    await feeXdxDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await xdx.setMinter(deployer.address, true);
    await xdx.mint(user0.address, toWei(1500, 18));
    expect(await xdx.balanceOf(user0.address)).eq(toWei(1500, 18));

    await xdx.connect(user0).approve(stakedXdxTracker.address, toWei(1000, 18));
    await expect(
      rewardRouter.connect(user0).stakeXdxForAccount(user1.address, toWei(1000, 18)),
    ).to.be.revertedWith("Governable: forbidden");

    await rewardRouter.setGov(user0.address);
    await rewardRouter.connect(user0).stakeXdxForAccount(user1.address, toWei(800, 18));
    expect(await xdx.balanceOf(user0.address)).eq(toWei(700, 18));

    await xdx.mint(user1.address, toWei(200, 18));
    expect(await xdx.balanceOf(user1.address)).eq(toWei(200, 18));
    await xdx.connect(user1).approve(stakedXdxTracker.address, toWei(200, 18));
    await rewardRouter.connect(user1).stakeXdx(toWei(200, 18));
    expect(await xdx.balanceOf(user1.address)).eq(0);

    expect(await stakedXdxTracker.stakedAmounts(user0.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user0.address, xdx.address)).eq(0);
    expect(await stakedXdxTracker.stakedAmounts(user1.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(toWei(1000, 18));

    expect(await bonusXdxTracker.stakedAmounts(user0.address)).eq(0);
    expect(await bonusXdxTracker.depositBalances(user0.address, stakedXdxTracker.address)).eq(0);
    expect(await bonusXdxTracker.stakedAmounts(user1.address)).eq(toWei(1000, 18));
    expect(await bonusXdxTracker.depositBalances(user1.address, stakedXdxTracker.address)).eq(
      toWei(1000, 18),
    );

    expect(await feeXdxTracker.stakedAmounts(user0.address)).eq(0);
    expect(await feeXdxTracker.depositBalances(user0.address, bonusXdxTracker.address)).eq(0);
    expect(await feeXdxTracker.stakedAmounts(user1.address)).eq(toWei(1000, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bonusXdxTracker.address)).eq(toWei(1000, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await stakedXdxTracker.claimable(user0.address)).eq(0);
    expect(await stakedXdxTracker.claimable(user1.address)).gt(toWei(1785, 18)); // 50000 / 28 => ~1785
    expect(await stakedXdxTracker.claimable(user1.address)).lt(toWei(1786, 18));

    expect(await bonusXdxTracker.claimable(user0.address)).eq(0);
    expect(await bonusXdxTracker.claimable(user1.address)).gt("2730000000000000000"); // 2.73, 1000 / 365 => ~2.74
    expect(await bonusXdxTracker.claimable(user1.address)).lt("2750000000000000000"); // 2.75

    expect(await feeXdxTracker.claimable(user0.address)).eq(0);
    expect(await feeXdxTracker.claimable(user1.address)).gt("3560000000000000000"); // 3.56, 100 / 28 => ~3.57
    expect(await feeXdxTracker.claimable(user1.address)).lt("3580000000000000000"); // 3.58

    await timelock.signalMint(esXdx.address, tokenManager.address, toWei(500, 18));
    await advanceTimeAndBlock(24 * 60 * 60);

    await timelock.processMint(esXdx.address, tokenManager.address, toWei(500, 18));
    await tokenManager.connect(deployer).signalApprove(esXdx.address, deployer.address, toWei(500, 18));
    const actionNonce = await tokenManager.actionsNonce();
    await tokenManager
      .connect(signer1)
      .signApprove(esXdx.address, deployer.address, toWei(500, 18), actionNonce);
    await tokenManager
      .connect(signer2)
      .signApprove(esXdx.address, deployer.address, toWei(500, 18), actionNonce);
    await tokenManager.approve(esXdx.address, deployer.address, toWei(500, 18), actionNonce);
    await esXdx.connect(deployer).transferFrom(tokenManager.address, user2.address, toWei(500, 18));

    await rewardRouter.connect(user2).stakeEsXdx(toWei(500, 18));

    expect(await stakedXdxTracker.stakedAmounts(user0.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user0.address, xdx.address)).eq(0);
    expect(await stakedXdxTracker.stakedAmounts(user1.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.stakedAmounts(user2.address)).eq(toWei(500, 18));
    expect(await stakedXdxTracker.depositBalances(user2.address, esXdx.address)).eq(toWei(500, 18));

    expect(await bonusXdxTracker.stakedAmounts(user0.address)).eq(0);
    expect(await bonusXdxTracker.depositBalances(user0.address, stakedXdxTracker.address)).eq(0);
    expect(await bonusXdxTracker.stakedAmounts(user1.address)).eq(toWei(1000, 18));
    expect(await bonusXdxTracker.depositBalances(user1.address, stakedXdxTracker.address)).eq(
      toWei(1000, 18),
    );
    expect(await bonusXdxTracker.stakedAmounts(user2.address)).eq(toWei(500, 18));
    expect(await bonusXdxTracker.depositBalances(user2.address, stakedXdxTracker.address)).eq(toWei(500, 18));

    expect(await feeXdxTracker.stakedAmounts(user0.address)).eq(0);
    expect(await feeXdxTracker.depositBalances(user0.address, bonusXdxTracker.address)).eq(0);
    expect(await feeXdxTracker.stakedAmounts(user1.address)).eq(toWei(1000, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bonusXdxTracker.address)).eq(toWei(1000, 18));
    expect(await feeXdxTracker.stakedAmounts(user2.address)).eq(toWei(500, 18));
    expect(await feeXdxTracker.depositBalances(user2.address, bonusXdxTracker.address)).eq(toWei(500, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await stakedXdxTracker.claimable(user0.address)).eq(0);
    expect(await stakedXdxTracker.claimable(user1.address)).gt(toWei(1785 + 2977, 18));
    expect(await stakedXdxTracker.claimable(user1.address)).lt(toWei(1786 + 2977, 18));
    expect(await stakedXdxTracker.claimable(user2.address)).gt(toWei(595, 18));
    expect(await stakedXdxTracker.claimable(user2.address)).lt(toWei(596, 18));

    expect(await bonusXdxTracker.claimable(user0.address)).eq(0);
    expect(await bonusXdxTracker.claimable(user1.address)).gt("8220000000000000000"); // 8.22, 1000 / 365 * 3 => ~8.22
    expect(await bonusXdxTracker.claimable(user1.address)).lt("8230000000000000000");
    expect(await bonusXdxTracker.claimable(user2.address)).gt("1360000000000000000"); // 1.36, 500 / 365 => ~1.37
    expect(await bonusXdxTracker.claimable(user2.address)).lt("1380000000000000000");

    expect(await feeXdxTracker.claimable(user0.address)).eq(0);
    expect(await feeXdxTracker.claimable(user1.address)).gt("9520000000000000000"); // 9.52, 3.57 + 100 / 28 / 3 * 5 => ~5.94
    expect(await feeXdxTracker.claimable(user1.address)).lt("9540000000000000000");
    expect(await feeXdxTracker.claimable(user2.address)).gt("1180000000000000000"); // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeXdxTracker.claimable(user2.address)).lt("1200000000000000000");

    expect(await esXdx.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).claimEsXdx();
    expect(await esXdx.balanceOf(user1.address)).gt(toWei(1785 + 2977, 18));
    expect(await esXdx.balanceOf(user1.address)).lt(toWei(1786 + 2977, 18));

    expect(await avax.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).claimFees();
    expect(await avax.balanceOf(user1.address)).gt("9520000000000000000");
    expect(await avax.balanceOf(user1.address)).lt("9540000000000000000");

    expect(await esXdx.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimEsXdx();
    expect(await esXdx.balanceOf(user2.address)).gt(toWei(595, 18));
    expect(await esXdx.balanceOf(user2.address)).lt(toWei(596, 18));

    expect(await avax.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimFees();
    expect(await avax.balanceOf(user2.address)).gt("1180000000000000000");
    expect(await avax.balanceOf(user2.address)).lt("1200000000000000000");

    await advanceTimeAndBlock(24 * 60 * 60);

    const tx0 = await rewardRouter.connect(user1).compound();
    await reportGasUsed(tx0, "compound gas used");

    await advanceTimeAndBlock(24 * 60 * 60);

    const tx1 = await rewardRouter.connect(user0).batchCompoundForAccounts([user1.address, user2.address]);
    await reportGasUsed(tx1, "batchCompoundForAccounts gas used");

    expect(await stakedXdxTracker.stakedAmounts(user1.address)).gt(toWei(3643, 18));
    expect(await stakedXdxTracker.stakedAmounts(user1.address)).lt(toWei(3645, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).gt(toWei(2643, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).lt(toWei(2645, 18));

    expect(await bonusXdxTracker.stakedAmounts(user1.address)).gt(toWei(3643, 18));
    expect(await bonusXdxTracker.stakedAmounts(user1.address)).lt(toWei(3645, 18));

    expect(await feeXdxTracker.stakedAmounts(user1.address)).gt(toWei(3661, 18));
    expect(await feeXdxTracker.stakedAmounts(user1.address)).lt(toWei(3662, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bonusXdxTracker.address)).gt(toWei(3643, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bonusXdxTracker.address)).lt(toWei(3645, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).gt("16900000000000000000"); // 16.9
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).lt("17000000000000000000"); // 17

    expect(await xdx.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).unstakeXdx(toWei(300, 18));
    expect(await xdx.balanceOf(user1.address)).eq(toWei(300, 18));

    expect(await stakedXdxTracker.stakedAmounts(user1.address)).gt(toWei(3343, 18));
    expect(await stakedXdxTracker.stakedAmounts(user1.address)).lt(toWei(3345, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(toWei(700, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).gt(toWei(2643, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).lt(toWei(2645, 18));

    expect(await bonusXdxTracker.stakedAmounts(user1.address)).gt(toWei(3343, 18));
    expect(await bonusXdxTracker.stakedAmounts(user1.address)).lt(toWei(3345, 18));

    expect(await feeXdxTracker.stakedAmounts(user1.address)).gt(toWei(3359, 18));
    expect(await feeXdxTracker.stakedAmounts(user1.address)).lt(toWei(3361, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bonusXdxTracker.address)).gt(toWei(3343, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bonusXdxTracker.address)).lt(toWei(3345, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).gt("15500000000000000000"); // 13
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).lt("15600000000000000000"); // 13.1

    const esXdxBalance1 = await esXdx.balanceOf(user1.address);
    const esXdxUnstakeBalance1 = await stakedXdxTracker.depositBalances(user1.address, esXdx.address);
    await rewardRouter.connect(user1).unstakeEsXdx(esXdxUnstakeBalance1);
    expect(await esXdx.balanceOf(user1.address)).eq(esXdxBalance1.add(esXdxUnstakeBalance1));

    expect(await stakedXdxTracker.stakedAmounts(user1.address)).eq(toWei(700, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(toWei(700, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).eq(0);

    expect(await bonusXdxTracker.stakedAmounts(user1.address)).eq(toWei(700, 18));

    expect(await feeXdxTracker.stakedAmounts(user1.address)).gt(toWei(703, 18));
    expect(await feeXdxTracker.stakedAmounts(user1.address)).lt(toWei(704, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bonusXdxTracker.address)).eq(toWei(700, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).gt("3250000000000000000"); // 3.25
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).lt("3260000000000000000"); // 3.25

    await expect(rewardRouter.connect(user1).unstakeEsXdx(toWei(1, 18))).to.be.revertedWith(
      "RewardTracker: _amount exceeds depositBalance",
    );
  });

  it("mintAndStakeXlx, unstakeAndRedeemXlx, compound, batchCompoundForAccounts", async () => {
    await avax.mint(feeXlxDistributor.address, toWei(100, 18));
    await feeXlxDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await avax.mint(user1.address, toWei(1, 18));
    await avax.connect(user1).approve(xlxManager.address, toWei(1, 18));
    const tx0 = await rewardRouter
      .connect(user1)
      .mintAndStakeXlx(avax.address, toWei(1, 18), toWei(280, 18), toWei(280, 18));
    await reportGasUsed(tx0, "mintAndStakeXlx gas used");

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await feeXlxTracker.depositBalances(user1.address, xlx.address)).eq(toWei(28428.75, 16));

    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await stakedXlxTracker.depositBalances(user1.address, feeXlxTracker.address)).eq(
      toWei(28428.75, 16),
    );

    await avax.mint(user1.address, toWei(2, 18));
    await avax.connect(user1).approve(xlxManager.address, toWei(2, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeXlx(avax.address, toWei(2, 18), toWei(560, 18), toWei(500, 18));

    await advanceTimeAndBlock(24 * 60 * 60 + 1);

    expect(await feeXlxTracker.claimable(user1.address)).gt("3560000000000000000"); // 3.56, 100 / 28 => ~3.57
    expect(await feeXlxTracker.claimable(user1.address)).lt("3580000000000000000"); // 3.58

    expect(await stakedXlxTracker.claimable(user1.address)).gt(toWei(1785, 18)); // 50000 / 28 => ~1785
    expect(await stakedXlxTracker.claimable(user1.address)).lt(toWei(1786, 18));

    await avax.mint(user2.address, toWei(1, 18));
    await avax.connect(user2).approve(xlxManager.address, toWei(1, 18));
    await rewardRouter
      .connect(user2)
      .mintAndStakeXlx(avax.address, toWei(1, 18), toWei(280, 18), toWei(240, 18));

    await expect(
      rewardRouter.connect(user2).unstakeAndRedeemXlx(
        avax.address,
        toWei(240, 18),
        "830000000000000000", // 0.83
        user2.address,
      ),
    ).to.be.revertedWith("XlxManager: cooldown duration not yet passed");

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq("798196785714285714285"); // 798.6
    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq("798196785714285714285");
    expect(await avax.balanceOf(user1.address)).eq(0);

    const tx1 = await rewardRouter.connect(user1).unstakeAndRedeemXlx(
      avax.address,
      toWei(240, 18),
      "830000000000000000", // 0.83
      user1.address,
    );
    await reportGasUsed(tx1, "unstakeAndRedeemXlx gas used");

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq("558196785714285714285"); // 558.6
    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq("558196785714285714285");
    expect(await avax.balanceOf(user1.address)).eq("833378240833073316"); // ~0.83

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await feeXlxTracker.claimable(user1.address)).gt("6060000000000000000"); // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeXlxTracker.claimable(user1.address)).lt("6070000000000000000");
    expect(await feeXlxTracker.claimable(user2.address)).gt("1070000000000000000"); // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeXlxTracker.claimable(user2.address)).lt("1080000000000000000");

    expect(await stakedXlxTracker.claimable(user1.address)).gt(toWei(3033, 18));
    expect(await stakedXlxTracker.claimable(user1.address)).lt(toWei(3034, 18));
    expect(await stakedXlxTracker.claimable(user2.address)).gt(toWei(537, 18));
    expect(await stakedXlxTracker.claimable(user2.address)).lt(toWei(538, 18));

    expect(await esXdx.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).claimEsXdx();
    expect(await esXdx.balanceOf(user1.address)).gt(toWei(3033, 18));
    expect(await esXdx.balanceOf(user1.address)).lt(toWei(3034, 18));

    expect(await avax.balanceOf(user1.address)).eq("833378240833073316");
    await rewardRouter.connect(user1).claimFees();
    expect(await avax.balanceOf(user1.address)).gt("6900000000000000000");
    expect(await avax.balanceOf(user1.address)).lt("6910000000000000000");

    expect(await esXdx.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimEsXdx();
    expect(await esXdx.balanceOf(user2.address)).gt(toWei(537, 18));
    expect(await esXdx.balanceOf(user2.address)).lt(toWei(538, 18));

    expect(await avax.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimFees();
    expect(await avax.balanceOf(user2.address)).gt("1070000000000000000");
    expect(await avax.balanceOf(user2.address)).lt("1080000000000000000");

    await advanceTimeAndBlock(24 * 60 * 60);

    const tx2 = await rewardRouter.connect(user1).compound();
    await reportGasUsed(tx2, "compound gas used");

    await advanceTimeAndBlock(24 * 60 * 60);

    const tx3 = await rewardRouter.batchCompoundForAccounts([user1.address, user2.address]);
    await reportGasUsed(tx1, "batchCompoundForAccounts gas used");

    expect(await stakedXdxTracker.stakedAmounts(user1.address)).gt(toWei(4281, 18));
    expect(await stakedXdxTracker.stakedAmounts(user1.address)).lt(toWei(4282, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).gt(toWei(4281, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).lt(toWei(4282, 18));

    expect(await bonusXdxTracker.stakedAmounts(user1.address)).gt(toWei(4281, 18));
    expect(await bonusXdxTracker.stakedAmounts(user1.address)).lt(toWei(4282, 18));

    expect(await feeXdxTracker.stakedAmounts(user1.address)).gt(toWei(4295, 18));
    expect(await feeXdxTracker.stakedAmounts(user1.address)).lt(toWei(4296, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bonusXdxTracker.address)).gt(toWei(4281, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bonusXdxTracker.address)).lt(toWei(4282, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).gt("13600000000000000000"); // 13.6
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).lt("13700000000000000000"); // 13.7

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq("558196785714285714285"); // 558.59
    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq("558196785714285714285");
    expect(await (await avax.balanceOf(user1.address)).div(toWei(1, 15))).eq("6900"); // ~0.69
  });

  it("mintAndStakeXlxETH, unstakeAndRedeemXlxETH", async () => {
    const receiver0 = Wallet.createRandom();
    await expect(
      rewardRouter.connect(user0).mintAndStakeXlxETH(toWei(300, 18), toWei(300, 18), { value: 0 }),
    ).to.be.revertedWith("RewardRouter: invalid msg.value");

    await expect(
      rewardRouter.connect(user0).mintAndStakeXlxETH(toWei(300, 18), toWei(300, 18), {
        value: toWei(1, 18),
      }),
    ).to.be.revertedWith("XlxManager: insufficient USDG output");

    await expect(
      rewardRouter.connect(user0).mintAndStakeXlxETH(toWei(280, 18), toWei(300, 18), {
        value: toWei(1, 18),
      }),
    ).to.be.revertedWith("XlxManager: insufficient XLX output");

    expect(await avax.balanceOf(user0.address)).eq(0);
    expect(await avax.balanceOf(vault.address)).eq(0);
    expect(await avax.totalSupply()).eq(0);
    expect(await ship.provider.getBalance(avax.address)).eq(0);
    expect(await stakedXlxTracker.balanceOf(user0.address)).eq(0);

    await rewardRouter
      .connect(user0)
      .mintAndStakeXlxETH(toWei(280, 18), toWei(280, 18), { value: toWei(1, 18) });

    expect(await avax.balanceOf(user0.address)).eq(0);
    expect(await avax.balanceOf(vault.address)).eq(toWei(1, 18));
    expect(await ship.provider.getBalance(avax.address)).eq(toWei(1, 18));
    expect(await avax.totalSupply()).eq(toWei(1, 18));
    expect(await stakedXlxTracker.balanceOf(user0.address)).eq("284287500000000000000"); // 284.2875

    await expect(
      rewardRouter.connect(user0).unstakeAndRedeemXlxETH(toWei(300, 18), toWei(1, 18), receiver0.address),
    ).to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    await expect(
      rewardRouter
        .connect(user0)
        .unstakeAndRedeemXlxETH("284287500000000000000", toWei(1, 18), receiver0.address),
    ).to.be.revertedWith("XlxManager: cooldown duration not yet passed");

    await advanceTimeAndBlock(24 * 60 * 60 + 10);
    await expect(
      rewardRouter
        .connect(user0)
        .unstakeAndRedeemXlxETH("284287500000000000000", toWei(1, 18), receiver0.address),
    ).to.be.revertedWith("XlxManager: insufficient output");

    await rewardRouter
      .connect(user0)
      .unstakeAndRedeemXlxETH("284287500000000000000", "900000000000000000", receiver0.address);
    expect(await ship.provider.getBalance(receiver0.address)).eq("900243750000000000"); // 0.900243
    expect(await avax.balanceOf(vault.address)).eq("99756250000000000"); // 0.99756
    expect(await ship.provider.getBalance(avax.address)).eq("99756250000000000");
    expect(await avax.totalSupply()).eq("99756250000000000");
  });

  it("xdx: signalTransfer, acceptTransfer", async () => {
    await xdx.setMinter(deployer.address, true);
    await xdx.mint(user1.address, toWei(200, 18));
    expect(await xdx.balanceOf(user1.address)).eq(toWei(200, 18));
    await xdx.connect(user1).approve(stakedXdxTracker.address, toWei(200, 18));
    await rewardRouter.connect(user1).stakeXdx(toWei(200, 18));
    expect(await xdx.balanceOf(user1.address)).eq(0);

    await xdx.mint(user2.address, toWei(200, 18));
    expect(await xdx.balanceOf(user2.address)).eq(toWei(200, 18));
    await xdx.connect(user2).approve(stakedXdxTracker.address, toWei(400, 18));
    await rewardRouter.connect(user2).stakeXdx(toWei(200, 18));
    expect(await xdx.balanceOf(user2.address)).eq(0);

    await rewardRouter.connect(user2).signalTransfer(user1.address);

    await advanceTimeAndBlock(24 * 60 * 60);

    await rewardRouter.connect(user2).signalTransfer(user1.address);
    await rewardRouter.connect(user1).claim();

    await expect(rewardRouter.connect(user2).signalTransfer(user1.address)).to.be.revertedWith(
      "RewardRouter: stakedXdxTracker.averageStakedAmounts > 0",
    );

    await rewardRouter.connect(user2).signalTransfer(user3.address);

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address)).to.be.revertedWith(
      "RewardRouter: transfer not signalled",
    );

    await xdxVester.setBonusRewards(user2.address, toWei(100, 18));

    expect(await stakedXdxTracker.depositBalances(user2.address, xdx.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.depositBalances(user2.address, esXdx.address)).eq(0);
    expect(await feeXdxTracker.depositBalances(user2.address, bnXdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user3.address, xdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user3.address, esXdx.address)).eq(0);
    expect(await feeXdxTracker.depositBalances(user3.address, bnXdx.address)).eq(0);
    expect(await xdxVester.transferredAverageStakedAmounts(user3.address)).eq(0);
    expect(await xdxVester.transferredCumulativeRewards(user3.address)).eq(0);
    expect(await xdxVester.bonusRewards(user2.address)).eq(toWei(100, 18));
    expect(await xdxVester.bonusRewards(user3.address)).eq(0);
    expect(await xdxVester.getCombinedAverageStakedAmount(user2.address)).eq(0);
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).eq(0);
    expect(await xdxVester.getMaxVestableAmount(user2.address)).eq(toWei(100, 18));
    expect(await xdxVester.getMaxVestableAmount(user3.address)).eq(0);
    expect(await xdxVester.getPairAmount(user2.address, toWei(892, 18))).eq(0);
    expect(await xdxVester.getPairAmount(user3.address, toWei(892, 18))).eq(0);

    await rewardRouter.connect(user3).acceptTransfer(user2.address);

    expect(await stakedXdxTracker.depositBalances(user2.address, xdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user2.address, esXdx.address)).eq(0);
    expect(await feeXdxTracker.depositBalances(user2.address, bnXdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user3.address, xdx.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.depositBalances(user3.address, esXdx.address)).gt(toWei(892, 18));
    expect(await stakedXdxTracker.depositBalances(user3.address, esXdx.address)).lt(toWei(893, 18));
    expect(await feeXdxTracker.depositBalances(user3.address, bnXdx.address)).gt("547000000000000000"); // 0.547
    expect(await feeXdxTracker.depositBalances(user3.address, bnXdx.address)).lt("549000000000000000"); // 0.548
    expect(await xdxVester.transferredAverageStakedAmounts(user3.address)).eq(toWei(200, 18));
    expect(await xdxVester.transferredCumulativeRewards(user3.address)).gt(toWei(892, 18));
    expect(await xdxVester.transferredCumulativeRewards(user3.address)).lt(toWei(893, 18));
    expect(await xdxVester.bonusRewards(user2.address)).eq(0);
    expect(await xdxVester.bonusRewards(user3.address)).eq(toWei(100, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user2.address)).eq(toWei(200, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).eq(toWei(200, 18));
    expect(await xdxVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await xdxVester.getMaxVestableAmount(user3.address)).gt(toWei(992, 18));
    expect(await xdxVester.getMaxVestableAmount(user3.address)).lt(toWei(993, 18));
    expect(await xdxVester.getPairAmount(user2.address, toWei(992, 18))).eq(0);
    expect(await xdxVester.getPairAmount(user3.address, toWei(992, 18))).gt(toWei(199, 18));
    expect(await xdxVester.getPairAmount(user3.address, toWei(992, 18))).lt(toWei(200, 18));

    await xdx.connect(user3).approve(stakedXdxTracker.address, toWei(400, 18));
    await rewardRouter.connect(user3).signalTransfer(user4.address);
    await rewardRouter.connect(user4).acceptTransfer(user3.address);

    expect(await stakedXdxTracker.depositBalances(user3.address, xdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user3.address, esXdx.address)).eq(0);
    expect(await feeXdxTracker.depositBalances(user3.address, bnXdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user4.address, xdx.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.depositBalances(user4.address, esXdx.address)).gt(toWei(892, 18));
    expect(await stakedXdxTracker.depositBalances(user4.address, esXdx.address)).lt(toWei(894, 18));
    expect(await feeXdxTracker.depositBalances(user4.address, bnXdx.address)).gt("547000000000000000"); // 0.547
    expect(await feeXdxTracker.depositBalances(user4.address, bnXdx.address)).lt("549000000000000000"); // 0.548
    expect(await xdxVester.transferredAverageStakedAmounts(user4.address)).gt(toWei(200, 18));
    expect(await xdxVester.transferredAverageStakedAmounts(user4.address)).lt(toWei(201, 18));
    expect(await xdxVester.transferredCumulativeRewards(user4.address)).gt(toWei(892, 18));
    expect(await xdxVester.transferredCumulativeRewards(user4.address)).lt(toWei(894, 18));
    expect(await xdxVester.bonusRewards(user3.address)).eq(0);
    expect(await xdxVester.bonusRewards(user4.address)).eq(toWei(100, 18));
    expect(await stakedXdxTracker.averageStakedAmounts(user3.address)).gt(toWei(1092, 18));
    expect(await stakedXdxTracker.averageStakedAmounts(user3.address)).lt(toWei(1094, 18));
    expect(await xdxVester.transferredAverageStakedAmounts(user3.address)).eq(0);
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).gt(toWei(1092, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).lt(toWei(1094, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user4.address)).gt(toWei(200, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user4.address)).lt(toWei(201, 18));
    expect(await xdxVester.getMaxVestableAmount(user3.address)).eq(0);
    expect(await xdxVester.getMaxVestableAmount(user4.address)).gt(toWei(992, 18));
    expect(await xdxVester.getMaxVestableAmount(user4.address)).lt(toWei(993, 18));
    expect(await xdxVester.getPairAmount(user3.address, toWei(992, 18))).eq(0);
    expect(await xdxVester.getPairAmount(user4.address, toWei(992, 18))).gt(toWei(199, 18));
    expect(await xdxVester.getPairAmount(user4.address, toWei(992, 18))).lt(toWei(200, 18));

    await expect(rewardRouter.connect(user4).acceptTransfer(user3.address)).to.be.revertedWith(
      "RewardRouter: transfer not signalled",
    );
  });

  it("xdx, xlx: signalTransfer, acceptTransfer", async () => {
    await xdx.setMinter(deployer.address, true);
    await xdx.mint(xdxVester.address, toWei(10000, 18));
    await xdx.mint(xlxVester.address, toWei(10000, 18));
    await avax.mint(feeXlxDistributor.address, toWei(100, 18));
    await feeXlxDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await avax.mint(user1.address, toWei(1, 18));
    await avax.connect(user1).approve(xlxManager.address, toWei(1, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeXlx(avax.address, toWei(1, 18), toWei(280, 18), toWei(280, 18));

    await avax.mint(user2.address, toWei(1, 18));
    await avax.connect(user2).approve(xlxManager.address, toWei(1, 18));
    await rewardRouter
      .connect(user2)
      .mintAndStakeXlx(avax.address, toWei(1, 18), toWei(280, 18), toWei(250, 18));

    await xdx.mint(user1.address, toWei(200, 18));
    expect(await xdx.balanceOf(user1.address)).eq(toWei(200, 18));
    await xdx.connect(user1).approve(stakedXdxTracker.address, toWei(200, 18));
    await rewardRouter.connect(user1).stakeXdx(toWei(200, 18));
    expect(await xdx.balanceOf(user1.address)).eq(0);

    await xdx.mint(user2.address, toWei(200, 18));
    expect(await xdx.balanceOf(user2.address)).eq(toWei(200, 18));
    await xdx.connect(user2).approve(stakedXdxTracker.address, toWei(400, 18));
    await rewardRouter.connect(user2).stakeXdx(toWei(200, 18));
    expect(await xdx.balanceOf(user2.address)).eq(0);

    await rewardRouter.connect(user2).signalTransfer(user1.address);

    await advanceTimeAndBlock(24 * 60 * 60);

    await rewardRouter.connect(user2).signalTransfer(user1.address);
    await rewardRouter.connect(user1).compound();

    await expect(rewardRouter.connect(user2).signalTransfer(user1.address)).to.be.revertedWith(
      "RewardRouter: stakedXdxTracker.averageStakedAmounts > 0",
    );

    await rewardRouter.connect(user2).signalTransfer(user3.address);

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address)).to.be.revertedWith(
      "RewardRouter: transfer not signalled",
    );

    await xdxVester.setBonusRewards(user2.address, toWei(100, 18));

    expect(await stakedXdxTracker.depositBalances(user2.address, xdx.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.depositBalances(user2.address, esXdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user3.address, xdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user3.address, esXdx.address)).eq(0);

    expect(await feeXdxTracker.depositBalances(user2.address, bnXdx.address)).eq(0);
    expect(await feeXdxTracker.depositBalances(user3.address, bnXdx.address)).eq(0);

    expect(await feeXlxTracker.depositBalances(user2.address, xlx.address)).eq("256954642857142857142"); // 256.95
    expect(await feeXlxTracker.depositBalances(user3.address, xlx.address)).eq(0);

    expect(await stakedXlxTracker.depositBalances(user2.address, feeXlxTracker.address)).eq(
      "256954642857142857142",
    ); // 256.95
    expect(await stakedXlxTracker.depositBalances(user3.address, feeXlxTracker.address)).eq(0);

    expect(await xdxVester.transferredAverageStakedAmounts(user3.address)).eq(0);
    expect(await xdxVester.transferredCumulativeRewards(user3.address)).eq(0);
    expect(await xdxVester.bonusRewards(user2.address)).eq(toWei(100, 18));
    expect(await xdxVester.bonusRewards(user3.address)).eq(0);
    expect(await xdxVester.getCombinedAverageStakedAmount(user2.address)).eq(0);
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).eq(0);
    expect(await xdxVester.getMaxVestableAmount(user2.address)).eq(toWei(100, 18));
    expect(await xdxVester.getMaxVestableAmount(user3.address)).eq(0);
    expect(await xdxVester.getPairAmount(user2.address, toWei(892, 18))).eq(0);
    expect(await xdxVester.getPairAmount(user3.address, toWei(892, 18))).eq(0);

    await rewardRouter.connect(user3).acceptTransfer(user2.address);

    expect(await stakedXdxTracker.depositBalances(user2.address, xdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user2.address, esXdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user3.address, xdx.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.depositBalances(user3.address, esXdx.address)).gt(toWei(1740, 18));
    expect(await stakedXdxTracker.depositBalances(user3.address, esXdx.address)).lt(toWei(1741, 18));

    expect(await feeXdxTracker.depositBalances(user2.address, bnXdx.address)).eq(0);
    expect(await feeXdxTracker.depositBalances(user3.address, bnXdx.address)).gt("547000000000000000"); // 0.547
    expect(await feeXdxTracker.depositBalances(user3.address, bnXdx.address)).lt("549000000000000000"); // 0.548

    expect(await feeXlxTracker.depositBalances(user2.address, xlx.address)).eq(0);
    expect(await feeXlxTracker.depositBalances(user3.address, xlx.address)).eq("256954642857142857142"); // 256.95

    expect(await stakedXlxTracker.depositBalances(user2.address, feeXlxTracker.address)).eq(0);
    expect(await stakedXlxTracker.depositBalances(user3.address, feeXlxTracker.address)).eq(
      "256954642857142857142",
    ); // 256.95

    expect(await xdxVester.transferredAverageStakedAmounts(user3.address)).eq(toWei(200, 18));
    expect(await xdxVester.transferredCumulativeRewards(user3.address)).gt(toWei(892, 18));
    expect(await xdxVester.transferredCumulativeRewards(user3.address)).lt(toWei(893, 18));
    expect(await xdxVester.bonusRewards(user2.address)).eq(0);
    expect(await xdxVester.bonusRewards(user3.address)).eq(toWei(100, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user2.address)).eq(toWei(200, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).eq(toWei(200, 18));
    expect(await xdxVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await xdxVester.getMaxVestableAmount(user3.address)).gt(toWei(992, 18));
    expect(await xdxVester.getMaxVestableAmount(user3.address)).lt(toWei(993, 18));
    expect(await xdxVester.getPairAmount(user2.address, toWei(992, 18))).eq(0);
    expect(await xdxVester.getPairAmount(user3.address, toWei(992, 18))).gt(toWei(199, 18));
    expect(await xdxVester.getPairAmount(user3.address, toWei(992, 18))).lt(toWei(200, 18));
    expect(await xdxVester.getPairAmount(user1.address, toWei(892, 18))).gt(toWei(199, 18));
    expect(await xdxVester.getPairAmount(user1.address, toWei(892, 18))).lt(toWei(200, 18));

    await rewardRouter.connect(user1).compound();

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address)).to.be.revertedWith(
      "RewardRouter: transfer not signalled",
    );

    await advanceTimeAndBlock(24 * 60 * 60);

    await rewardRouter.connect(user1).claim();
    await rewardRouter.connect(user2).claim();
    await rewardRouter.connect(user3).claim();

    expect(await xdxVester.getCombinedAverageStakedAmount(user1.address)).gt(toWei(1125, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user1.address)).lt(toWei(1126, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).gt(toWei(1060, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).lt(toWei(1061, 18));

    expect(await xdxVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await xdxVester.getMaxVestableAmount(user3.address)).gt(toWei(1865, 18));
    expect(await xdxVester.getMaxVestableAmount(user3.address)).lt(toWei(1866, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).gt(toWei(1806, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).lt(toWei(1807, 18));

    expect(await xdxVester.getPairAmount(user2.address, toWei(992, 18))).eq(0);
    expect(await xdxVester.getPairAmount(user3.address, toWei(1885, 18))).gt(toWei(1071, 18));
    expect(await xdxVester.getPairAmount(user3.address, toWei(1885, 18))).lt(toWei(1072, 18));
    expect(await xdxVester.getPairAmount(user1.address, toWei(1785, 18))).gt(toWei(1112, 18));
    expect(await xdxVester.getPairAmount(user1.address, toWei(1785, 18))).lt(toWei(1113, 18));

    await rewardRouter.connect(user1).compound();
    await rewardRouter.connect(user3).compound();

    expect(await feeXdxTracker.balanceOf(user1.address)).gt(toWei(2037, 18));
    expect(await feeXdxTracker.balanceOf(user1.address)).lt(toWei(2038, 18));

    await xdxVester.connect(user1).deposit(toWei(1785, 18));

    expect(await feeXdxTracker.balanceOf(user1.address)).gt(toWei(924, 18)); // 924
    expect(await feeXdxTracker.balanceOf(user1.address)).lt(toWei(925, 18)); // 925

    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).gt(toWei(6, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).lt(toWei(7, 18));

    await rewardRouter.connect(user1).unstakeXdx(toWei(200, 18));
    await expect(rewardRouter.connect(user1).unstakeEsXdx(toWei(730, 18))).to.be.revertedWith(
      "RewardTracker: burn amount exceeds balance",
    );

    await rewardRouter.connect(user1).unstakeEsXdx(toWei(599, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await feeXdxTracker.balanceOf(user1.address)).gt(toWei(123, 18));
    expect(await feeXdxTracker.balanceOf(user1.address)).lt(toWei(124, 18));

    expect(await esXdx.balanceOf(user1.address)).gt(toWei(665, 18));
    expect(await esXdx.balanceOf(user1.address)).lt(toWei(666, 18));

    expect(await xdx.balanceOf(user1.address)).eq(toWei(200, 18));

    await xdxVester.connect(user1).withdraw();

    expect(await feeXdxTracker.balanceOf(user1.address)).gt(toWei(1235, 18));
    expect(await feeXdxTracker.balanceOf(user1.address)).lt(toWei(1237, 18));

    expect(await esXdx.balanceOf(user1.address)).gt(toWei(2445, 18));
    expect(await esXdx.balanceOf(user1.address)).lt(toWei(2446, 18));

    expect(await xdx.balanceOf(user1.address)).gt(toWei(204, 18));
    expect(await xdx.balanceOf(user1.address)).lt(toWei(206, 18));

    expect(await xlxVester.getMaxVestableAmount(user3.address)).gt(toWei(1695, 18));
    expect(await xlxVester.getMaxVestableAmount(user3.address)).lt(toWei(1696, 18));

    expect(await xlxVester.getPairAmount(user3.address, toWei(1785, 18))).gt(toWei(270, 18));
    expect(await xlxVester.getPairAmount(user3.address, toWei(1785, 18))).lt(toWei(271, 18));

    expect(await stakedXlxTracker.balanceOf(user3.address)).eq("256954642857142857142");

    expect(await esXdx.balanceOf(user3.address)).gt(toWei(1720, 18));
    expect(await esXdx.balanceOf(user3.address)).lt(toWei(1721, 18));

    expect(await xdx.balanceOf(user3.address)).eq(0);

    await xlxVester.connect(user3).deposit(toWei(1695, 18));

    expect(await stakedXlxTracker.balanceOf(user3.address)).gt(0);
    expect(await stakedXlxTracker.balanceOf(user3.address)).lt(toWei(1, 18));

    expect(await esXdx.balanceOf(user3.address)).gt(toWei(25, 18));
    expect(await esXdx.balanceOf(user3.address)).lt(toWei(26, 18));

    expect(await xdx.balanceOf(user3.address)).eq(0);

    await expect(
      rewardRouter.connect(user3).unstakeAndRedeemXlx(avax.address, toWei(1, 18), 0, user3.address),
    ).to.be.revertedWith("RewardTracker: burn amount exceeds balance");

    await advanceTimeAndBlock(24 * 60 * 60);

    await xlxVester.connect(user3).withdraw();

    expect(await stakedXlxTracker.balanceOf(user3.address)).eq("256954642857142857142");

    expect(await esXdx.balanceOf(user3.address)).gt(toWei(1715, 18));
    expect(await esXdx.balanceOf(user3.address)).lt(toWei(1716, 18));

    expect(await xdx.balanceOf(user3.address)).gt(toWei(4, 18));
    expect(await xdx.balanceOf(user3.address)).lt(toWei(6, 18));

    expect(await feeXdxTracker.balanceOf(user1.address)).gt(toWei(1235, 18));
    expect(await feeXdxTracker.balanceOf(user1.address)).lt(toWei(1237, 18));

    expect(await esXdx.balanceOf(user1.address)).gt(toWei(2445, 18));
    expect(await esXdx.balanceOf(user1.address)).lt(toWei(2446, 18));

    expect(await xdx.balanceOf(user1.address)).gt(toWei(204, 18));
    expect(await xdx.balanceOf(user1.address)).lt(toWei(206, 18));

    await xdxVester.connect(user1).deposit(toWei(365 * 2, 18));

    expect(await feeXdxTracker.balanceOf(user1.address)).gt(toWei(780, 18));
    expect(await feeXdxTracker.balanceOf(user1.address)).lt(toWei(782, 18));

    expect(await xdxVester.claimable(user1.address)).eq(0);

    await advanceTimeAndBlock(48 * 60 * 60);

    expect(await xdxVester.claimable(user1.address)).gt("3900000000000000000"); // 3.9
    expect(await xdxVester.claimable(user1.address)).lt("4100000000000000000"); // 4.1

    await xdxVester.connect(user1).deposit(toWei(365, 18));

    expect(await feeXdxTracker.balanceOf(user1.address)).gt(toWei(555, 18));
    expect(await feeXdxTracker.balanceOf(user1.address)).lt(toWei(556, 18));

    await advanceTimeAndBlock(48 * 60 * 60);

    expect(await xdxVester.claimable(user1.address)).gt("9900000000000000000"); // 9.9
    expect(await xdxVester.claimable(user1.address)).lt("10100000000000000000"); // 10.1

    expect(await xdx.balanceOf(user1.address)).gt(toWei(204, 18));
    expect(await xdx.balanceOf(user1.address)).lt(toWei(206, 18));

    await xdxVester.connect(user1).claim();

    expect(await xdx.balanceOf(user1.address)).gt(toWei(214, 18));
    expect(await xdx.balanceOf(user1.address)).lt(toWei(216, 18));

    await xdxVester.connect(user1).deposit(toWei(365, 18));
    expect(await xdxVester.balanceOf(user1.address)).gt(toWei(1449, 18)); // 365 * 4 => 1460, 1460 - 10 => 1450
    expect(await xdxVester.balanceOf(user1.address)).lt(toWei(1451, 18));
    expect(await xdxVester.getVestedAmount(user1.address)).eq(toWei(1460, 18));

    expect(await feeXdxTracker.balanceOf(user1.address)).gt(toWei(332, 18)); // 522 - 303 => 219
    expect(await feeXdxTracker.balanceOf(user1.address)).lt(toWei(333, 18));

    await advanceTimeAndBlock(48 * 60 * 60);

    expect(await xdxVester.claimable(user1.address)).gt("7900000000000000000"); // 7.9
    expect(await xdxVester.claimable(user1.address)).lt("8100000000000000000"); // 8.1

    await xdxVester.connect(user1).withdraw();

    expect(await feeXdxTracker.balanceOf(user1.address)).gt(toWei(1235, 18));
    expect(await feeXdxTracker.balanceOf(user1.address)).lt(toWei(1237, 18));

    expect(await xdx.balanceOf(user1.address)).gt(toWei(222, 18));
    expect(await xdx.balanceOf(user1.address)).lt(toWei(224, 18));

    expect(await esXdx.balanceOf(user1.address)).gt(toWei(2427, 18));
    expect(await esXdx.balanceOf(user1.address)).lt(toWei(2428, 18));

    await xdxVester.connect(user1).deposit(toWei(365, 18));

    await advanceTimeAndBlock(500 * 24 * 60 * 60);

    expect(await xdxVester.claimable(user1.address)).eq(toWei(365, 18));

    await xdxVester.connect(user1).withdraw();

    expect(await xdx.balanceOf(user1.address)).gt(toWei(222 + 365, 18));
    expect(await xdx.balanceOf(user1.address)).lt(toWei(224 + 365, 18));

    expect(await esXdx.balanceOf(user1.address)).gt(toWei(2062, 18));
    expect(await esXdx.balanceOf(user1.address)).lt(toWei(2063, 18));

    expect(await xdxVester.transferredAverageStakedAmounts(user2.address)).eq(0);
    expect(await xdxVester.transferredAverageStakedAmounts(user3.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user2.address)).gt(toWei(892, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user2.address)).lt(toWei(893, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user3.address)).gt(toWei(872, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user3.address)).lt(toWei(873, 18));
    expect(await xdxVester.transferredCumulativeRewards(user3.address)).gt(toWei(892, 18));
    expect(await xdxVester.transferredCumulativeRewards(user3.address)).lt(toWei(893, 18));
    expect(await xdxVester.bonusRewards(user2.address)).eq(0);
    expect(await xdxVester.bonusRewards(user3.address)).eq(toWei(100, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user2.address)).eq(toWei(200, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).gt(toWei(1060, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).lt(toWei(1061, 18));
    expect(await xdxVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await xdxVester.getMaxVestableAmount(user3.address)).gt(toWei(1865, 18));
    expect(await xdxVester.getMaxVestableAmount(user3.address)).lt(toWei(1866, 18));
    expect(await xdxVester.getPairAmount(user2.address, toWei(992, 18))).eq(0);
    expect(await xdxVester.getPairAmount(user3.address, toWei(992, 18))).gt(toWei(563, 18));
    expect(await xdxVester.getPairAmount(user3.address, toWei(992, 18))).lt(toWei(564, 18));
    expect(await xdxVester.getPairAmount(user1.address, toWei(892, 18))).gt(toWei(556, 18));
    expect(await xdxVester.getPairAmount(user1.address, toWei(892, 18))).lt(toWei(557, 18));

    const esXdxBatchSender = (await ship.deploy(EsXdxBatchSender__factory, { args: [esXdx.address] }))
      .contract;

    await timelock.signalSetHandler(esXdx.address, esXdxBatchSender.address, true);
    await timelock.signalSetHandler(xdxVester.address, esXdxBatchSender.address, true);
    await timelock.signalSetHandler(xlxVester.address, esXdxBatchSender.address, true);
    await timelock.signalMint(esXdx.address, deployer.address, toWei(1000, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    await timelock.setHandler(esXdx.address, esXdxBatchSender.address, true);
    await timelock.setHandler(xdxVester.address, esXdxBatchSender.address, true);
    await timelock.setHandler(xlxVester.address, esXdxBatchSender.address, true);
    await timelock.processMint(esXdx.address, deployer.address, toWei(1000, 18));

    await esXdxBatchSender
      .connect(deployer)
      .send(xdxVester.address, 4, [user2.address, user3.address], [toWei(100, 18), toWei(200, 18)]);

    expect(await xdxVester.transferredAverageStakedAmounts(user2.address)).gt(toWei(37648, 18));
    expect(await xdxVester.transferredAverageStakedAmounts(user2.address)).lt(toWei(37649, 18));
    expect(await xdxVester.transferredAverageStakedAmounts(user3.address)).gt(toWei(12589, 18));
    expect(await xdxVester.transferredAverageStakedAmounts(user3.address)).lt(toWei(12590, 18));
    expect(await xdxVester.transferredCumulativeRewards(user2.address)).eq(toWei(100, 18));
    expect(await xdxVester.transferredCumulativeRewards(user3.address)).gt(toWei(892 + 200, 18));
    expect(await xdxVester.transferredCumulativeRewards(user3.address)).lt(toWei(893 + 200, 18));
    expect(await xdxVester.bonusRewards(user2.address)).eq(0);
    expect(await xdxVester.bonusRewards(user3.address)).eq(toWei(100, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user2.address)).gt(toWei(3971, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user2.address)).lt(toWei(3972, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).gt(toWei(7861, 18));
    expect(await xdxVester.getCombinedAverageStakedAmount(user3.address)).lt(toWei(7863, 18));
    expect(await xdxVester.getMaxVestableAmount(user2.address)).eq(toWei(100, 18));
    expect(await xdxVester.getMaxVestableAmount(user3.address)).gt(toWei(2065, 18));
    expect(await xdxVester.getMaxVestableAmount(user3.address)).lt(toWei(2066 + 200, 18));
    expect(await xdxVester.getPairAmount(user2.address, toWei(100, 18))).gt(toWei(3971, 18));
    expect(await xdxVester.getPairAmount(user2.address, toWei(100, 18))).lt(toWei(3972, 18));
    expect(await xdxVester.getPairAmount(user3.address, toWei(2065, 18))).gt(toWei(7860, 18));
    expect(await xdxVester.getPairAmount(user3.address, toWei(2065, 18))).lt(toWei(7861, 18));

    expect(await xlxVester.transferredAverageStakedAmounts(user4.address)).eq(0);
    expect(await xlxVester.transferredCumulativeRewards(user4.address)).eq(0);
    expect(await xlxVester.bonusRewards(user4.address)).eq(0);
    expect(await xlxVester.getCombinedAverageStakedAmount(user4.address)).eq(0);
    expect(await xlxVester.getMaxVestableAmount(user4.address)).eq(0);
    expect(await xlxVester.getPairAmount(user4.address, toWei(10, 18))).eq(0);

    await esXdxBatchSender.connect(deployer).send(xlxVester.address, 320, [user4.address], [toWei(10, 18)]);

    expect(await xlxVester.transferredAverageStakedAmounts(user4.address)).eq(toWei(3200, 18));
    expect(await xlxVester.transferredCumulativeRewards(user4.address)).eq(toWei(10, 18));
    expect(await xlxVester.bonusRewards(user4.address)).eq(0);
    expect(await xlxVester.getCombinedAverageStakedAmount(user4.address)).eq(toWei(3200, 18));
    expect(await xlxVester.getMaxVestableAmount(user4.address)).eq(toWei(10, 18));
    expect(await xlxVester.getPairAmount(user4.address, toWei(10, 18))).eq(toWei(3200, 18));

    await esXdxBatchSender.connect(deployer).send(xlxVester.address, 320, [user4.address], [toWei(10, 18)]);

    expect(await xlxVester.transferredAverageStakedAmounts(user4.address)).eq(toWei(6400, 18));
    expect(await xlxVester.transferredCumulativeRewards(user4.address)).eq(toWei(20, 18));
    expect(await xlxVester.bonusRewards(user4.address)).eq(0);
    expect(await xlxVester.getCombinedAverageStakedAmount(user4.address)).eq(toWei(6400, 18));
    expect(await xlxVester.getMaxVestableAmount(user4.address)).eq(toWei(20, 18));
    expect(await xlxVester.getPairAmount(user4.address, toWei(10, 18))).eq(toWei(3200, 18));
  });

  it("handleRewards", async () => {
    const timelockV2 = deployer;

    // use new rewardRouter, use eth for weth
    const rewardRouterV2 = (
      await ship.deploy(RewardRouterV2__factory, {
        aliasName: "NewRouter",
      })
    ).contract;
    await rewardRouterV2.initialize(
      avax.address,
      xdx.address,
      esXdx.address,
      bnXdx.address,
      xlx.address,
      stakedXdxTracker.address,
      bonusXdxTracker.address,
      feeXdxTracker.address,
      feeXlxTracker.address,
      stakedXlxTracker.address,
      xlxManager.address,
      xdxVester.address,
      xlxVester.address,
    );

    await timelock.signalSetGov(xlxManager.address, timelockV2.address);
    await timelock.signalSetGov(stakedXdxTracker.address, timelockV2.address);
    await timelock.signalSetGov(bonusXdxTracker.address, timelockV2.address);
    await timelock.signalSetGov(feeXdxTracker.address, timelockV2.address);
    await timelock.signalSetGov(feeXlxTracker.address, timelockV2.address);
    await timelock.signalSetGov(stakedXlxTracker.address, timelockV2.address);
    await timelock.signalSetGov(stakedXdxDistributor.address, timelockV2.address);
    await timelock.signalSetGov(stakedXlxDistributor.address, timelockV2.address);
    await timelock.signalSetGov(esXdx.address, timelockV2.address);
    await timelock.signalSetGov(bnXdx.address, timelockV2.address);
    await timelock.signalSetGov(xdxVester.address, timelockV2.address);
    await timelock.signalSetGov(xlxVester.address, timelockV2.address);

    await advanceTimeAndBlock(24 * 60 * 60);

    await timelock.setGov(xlxManager.address, timelockV2.address);
    await timelock.setGov(stakedXdxTracker.address, timelockV2.address);
    await timelock.setGov(bonusXdxTracker.address, timelockV2.address);
    await timelock.setGov(feeXdxTracker.address, timelockV2.address);
    await timelock.setGov(feeXlxTracker.address, timelockV2.address);
    await timelock.setGov(stakedXlxTracker.address, timelockV2.address);
    await timelock.setGov(stakedXdxDistributor.address, timelockV2.address);
    await timelock.setGov(stakedXlxDistributor.address, timelockV2.address);
    await timelock.setGov(esXdx.address, timelockV2.address);
    await timelock.setGov(bnXdx.address, timelockV2.address);
    await timelock.setGov(xdxVester.address, timelockV2.address);
    await timelock.setGov(xlxVester.address, timelockV2.address);

    await esXdx.setHandler(rewardRouterV2.address, true);
    await esXdx.setHandler(stakedXdxDistributor.address, true);
    await esXdx.setHandler(stakedXlxDistributor.address, true);
    await esXdx.setHandler(stakedXdxTracker.address, true);
    await esXdx.setHandler(stakedXlxTracker.address, true);
    await esXdx.setHandler(xdxVester.address, true);
    await esXdx.setHandler(xlxVester.address, true);

    await xlxManager.setHandler(rewardRouterV2.address, true);
    await stakedXdxTracker.setHandler(rewardRouterV2.address, true);
    await bonusXdxTracker.setHandler(rewardRouterV2.address, true);
    await feeXdxTracker.setHandler(rewardRouterV2.address, true);
    await feeXlxTracker.setHandler(rewardRouterV2.address, true);
    await stakedXlxTracker.setHandler(rewardRouterV2.address, true);

    await esXdx.setHandler(rewardRouterV2.address, true);
    await bnXdx.setMinter(rewardRouterV2.address, true);
    await esXdx.setMinter(xdxVester.address, true);
    await esXdx.setMinter(xlxVester.address, true);

    await xdxVester.setHandler(rewardRouterV2.address, true);
    await xlxVester.setHandler(rewardRouterV2.address, true);

    await feeXdxTracker.setHandler(xdxVester.address, true);
    await stakedXlxTracker.setHandler(xlxVester.address, true);

    await avax.deposit({ value: toWei(10, 18) });

    await xdx.setMinter(deployer.address, true);
    await xdx.mint(xdxVester.address, toWei(10000, 18));
    await xdx.mint(xlxVester.address, toWei(10000, 18));

    await avax.mint(feeXlxDistributor.address, toWei(50, 18));
    await feeXlxDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await avax.mint(feeXdxDistributor.address, toWei(50, 18));
    await feeXdxDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await avax.mint(user1.address, toWei(1, 18));
    await avax.connect(user1).approve(xlxManager.address, toWei(1, 18));
    await rewardRouterV2
      .connect(user1)
      .mintAndStakeXlx(avax.address, toWei(1, 18), toWei(280, 18), toWei(280, 18));

    await xdx.mint(user1.address, toWei(200, 18));
    expect(await xdx.balanceOf(user1.address)).eq(toWei(200, 18));
    await xdx.connect(user1).approve(stakedXdxTracker.address, toWei(200, 18));
    await rewardRouterV2.connect(user1).stakeXdx(toWei(200, 18));
    expect(await xdx.balanceOf(user1.address)).eq(0);

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await xdx.balanceOf(user1.address)).eq(0);
    expect(await esXdx.balanceOf(user1.address)).eq(0);
    expect(await bnXdx.balanceOf(user1.address)).eq(0);
    expect(await xlx.balanceOf(user1.address)).eq(0);
    expect(await avax.balanceOf(user1.address)).eq(0);

    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).eq(0);
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).eq(0);

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimXdx
      true, // _shouldStakeXdx
      true, // _shouldClaimEsXdx
      true, // _shouldStakeEsXdx
      true, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      false, // _shouldConvertWethToEth
    );

    expect(await xdx.balanceOf(user1.address)).eq(0);
    expect(await esXdx.balanceOf(user1.address)).eq(0);
    expect(await bnXdx.balanceOf(user1.address)).eq(0);
    expect(await xlx.balanceOf(user1.address)).eq(0);
    expect(await avax.balanceOf(user1.address)).gt(toWei(7, 18));
    expect(await avax.balanceOf(user1.address)).lt(toWei(8, 18));

    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).gt(toWei(3571, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).lt(toWei(3572, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).gt("1097000000000000000"); // 0.54
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).lt("1098000000000000000"); // 1.097

    await advanceTimeAndBlock(24 * 60 * 60);

    const ethBalance0 = await ship.provider.getBalance(user1.address);

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimXdx
      false, // _shouldStakeXdx
      false, // _shouldClaimEsXdx
      false, // _shouldStakeEsXdx
      false, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      true, // _shouldConvertWethToEth
    );

    const ethBalance1 = await ship.provider.getBalance(user1.address);

    expect(await ethBalance1.sub(ethBalance0)).gt(toWei(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(toWei(8, 18));
    expect(await xdx.balanceOf(user1.address)).eq(0);
    expect(await esXdx.balanceOf(user1.address)).eq(0);
    expect(await bnXdx.balanceOf(user1.address)).eq(0);
    expect(await xlx.balanceOf(user1.address)).eq(0);
    expect(await avax.balanceOf(user1.address)).gt(toWei(7, 18));
    expect(await avax.balanceOf(user1.address)).lt(toWei(8, 18));

    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).gt(toWei(3571, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).lt(toWei(3572, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).gt("1097000000000000000"); // 0.54
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).lt("1098000000000000000"); // 0.56

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimXdx
      false, // _shouldStakeXdx
      true, // _shouldClaimEsXdx
      false, // _shouldStakeEsXdx
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false, // _shouldConvertWethToEth
    );

    expect(await ethBalance1.sub(ethBalance0)).gt(toWei(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(toWei(8, 18));
    expect(await xdx.balanceOf(user1.address)).eq(0);
    expect(await esXdx.balanceOf(user1.address)).gt(toWei(3571, 18));
    expect(await esXdx.balanceOf(user1.address)).lt(toWei(3572, 18));
    expect(await bnXdx.balanceOf(user1.address)).eq(0);
    expect(await xlx.balanceOf(user1.address)).eq(0);
    expect(await avax.balanceOf(user1.address)).gt(toWei(7, 18));
    expect(await avax.balanceOf(user1.address)).lt(toWei(8, 18));

    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).gt(toWei(3571, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).lt(toWei(3572, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).gt("1096000000000000000"); // 0.54
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).lt("1098000000000000000"); // 0.56

    await xdxVester.connect(user1).deposit(toWei(365, 18));
    await xlxVester.connect(user1).deposit(toWei(365 * 2, 18));

    expect(await ethBalance1.sub(ethBalance0)).gt(toWei(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(toWei(8, 18));
    expect(await xdx.balanceOf(user1.address)).eq(0);
    expect(await esXdx.balanceOf(user1.address)).gt(toWei(3571 - 365 * 3, 18));
    expect(await esXdx.balanceOf(user1.address)).lt(toWei(3572 - 365 * 3, 18));
    expect(await bnXdx.balanceOf(user1.address)).eq(0);
    expect(await xlx.balanceOf(user1.address)).eq(0);
    expect(await avax.balanceOf(user1.address)).gt(toWei(7, 18));
    expect(await avax.balanceOf(user1.address)).lt(toWei(8, 18));

    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).gt(toWei(3571, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).lt(toWei(3572, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).gt("1096000000000000000"); // 0.54
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).lt("1098000000000000000"); // 0.56

    await advanceTimeAndBlock(24 * 60 * 60);

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimXdx
      false, // _shouldStakeXdx
      false, // _shouldClaimEsXdx
      false, // _shouldStakeEsXdx
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false, // _shouldConvertWethToEth
    );

    expect(await ethBalance1.sub(ethBalance0)).gt(toWei(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(toWei(8, 18));
    expect(await xdx.balanceOf(user1.address)).gt("2900000000000000000"); // 2.9
    expect(await xdx.balanceOf(user1.address)).lt("3100000000000000000"); // 3.1
    expect(await esXdx.balanceOf(user1.address)).gt(toWei(3571 - 365 * 3, 18));
    expect(await esXdx.balanceOf(user1.address)).lt(toWei(3572 - 365 * 3, 18));
    expect(await bnXdx.balanceOf(user1.address)).eq(0);
    expect(await xlx.balanceOf(user1.address)).eq(0);
    expect(await avax.balanceOf(user1.address)).gt(toWei(7, 18));
    expect(await avax.balanceOf(user1.address)).lt(toWei(8, 18));

    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(toWei(200, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).gt(toWei(3571, 18));
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).lt(toWei(3572, 18));
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).gt("1096000000000000000"); // 0.54
    expect(await feeXdxTracker.depositBalances(user1.address, bnXdx.address)).lt("1098000000000000000"); // 0.56
  });

  it("StakedXlx", async () => {
    await avax.mint(feeXlxDistributor.address, toWei(100, 18));
    await feeXlxDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await avax.mint(user1.address, toWei(1, 18));
    await avax.connect(user1).approve(xlxManager.address, toWei(1, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeXlx(avax.address, toWei(1, 18), toWei(280, 18), toWei(280, 18));

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await feeXlxTracker.depositBalances(user1.address, xlx.address)).eq(toWei(28428.75, 16));

    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await stakedXlxTracker.depositBalances(user1.address, feeXlxTracker.address)).eq(
      toWei(28428.75, 16),
    );

    await expect(
      stakedXlx.connect(user2).transferFrom(user1.address, user3.address, toWei(28428.75, 16)),
    ).to.be.revertedWith("StakedXlx: transfer amount exceeds allowance");

    await stakedXlx.connect(user1).approve(user2.address, toWei(28428.75, 16));

    await expect(
      stakedXlx.connect(user2).transferFrom(user1.address, user3.address, toWei(28428.75, 16)),
    ).to.be.revertedWith("StakedXlx: cooldown duration not yet passed");

    await advanceTimeAndBlock(24 * 60 * 60 + 10);

    await expect(
      stakedXlx.connect(user2).transferFrom(user1.address, user3.address, toWei(28428.75, 16)),
    ).to.be.revertedWith("RewardTracker: forbidden");

    await timelock.signalSetHandler(stakedXlxTracker.address, stakedXlx.address, true);
    await advanceTimeAndBlock(24 * 60 * 60);
    await timelock.setHandler(stakedXlxTracker.address, stakedXlx.address, true);

    await expect(
      stakedXlx.connect(user2).transferFrom(user1.address, user3.address, toWei(28428.75, 16)),
    ).to.be.revertedWith("RewardTracker: forbidden");

    await timelock.signalSetHandler(feeXlxTracker.address, stakedXlx.address, true);
    await advanceTimeAndBlock(24 * 60 * 60);
    await timelock.setHandler(feeXlxTracker.address, stakedXlx.address, true);

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await feeXlxTracker.depositBalances(user1.address, xlx.address)).eq(toWei(28428.75, 16));

    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await stakedXlxTracker.depositBalances(user1.address, feeXlxTracker.address)).eq(
      toWei(28428.75, 16),
    );

    expect(await feeXlxTracker.stakedAmounts(user3.address)).eq(0);
    expect(await feeXlxTracker.depositBalances(user3.address, xlx.address)).eq(0);

    expect(await stakedXlxTracker.stakedAmounts(user3.address)).eq(0);
    expect(await stakedXlxTracker.depositBalances(user3.address, feeXlxTracker.address)).eq(0);

    await stakedXlx.connect(user2).transferFrom(user1.address, user3.address, toWei(28428.75, 16));

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq(0);
    expect(await feeXlxTracker.depositBalances(user1.address, xlx.address)).eq(0);

    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq(0);
    expect(await stakedXlxTracker.depositBalances(user1.address, feeXlxTracker.address)).eq(0);

    expect(await feeXlxTracker.stakedAmounts(user3.address)).eq(toWei(28428.75, 16));
    expect(await feeXlxTracker.depositBalances(user3.address, xlx.address)).eq(toWei(28428.75, 16));

    expect(await stakedXlxTracker.stakedAmounts(user3.address)).eq(toWei(28428.75, 16));
    expect(await stakedXlxTracker.depositBalances(user3.address, feeXlxTracker.address)).eq(
      toWei(28428.75, 16),
    );

    await expect(
      stakedXlx.connect(user2).transferFrom(user3.address, user1.address, toWei(3000, 17)),
    ).to.be.revertedWith("StakedXlx: transfer amount exceeds allowance");

    await stakedXlx.connect(user3).approve(user2.address, toWei(3000, 17));

    await expect(
      stakedXlx.connect(user2).transferFrom(user3.address, user1.address, toWei(3000, 17)),
    ).to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    await stakedXlx.connect(user2).transferFrom(user3.address, user1.address, toWei(1000, 17));

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq(toWei(1000, 17));
    expect(await feeXlxTracker.depositBalances(user1.address, xlx.address)).eq(toWei(1000, 17));

    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq(toWei(1000, 17));
    expect(await stakedXlxTracker.depositBalances(user1.address, feeXlxTracker.address)).eq(toWei(1000, 17));

    expect(await feeXlxTracker.stakedAmounts(user3.address)).eq(toWei(18428.75, 16));
    expect(await feeXlxTracker.depositBalances(user3.address, xlx.address)).eq(toWei(18428.75, 16));

    expect(await stakedXlxTracker.stakedAmounts(user3.address)).eq(toWei(18428.75, 16));
    expect(await stakedXlxTracker.depositBalances(user3.address, feeXlxTracker.address)).eq(
      toWei(18428.75, 16),
    );

    await stakedXlx.connect(user3).transfer(user1.address, toWei(1500, 17));

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq(toWei(2500, 17));
    expect(await feeXlxTracker.depositBalances(user1.address, xlx.address)).eq(toWei(2500, 17));

    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq(toWei(2500, 17));
    expect(await stakedXlxTracker.depositBalances(user1.address, feeXlxTracker.address)).eq(toWei(2500, 17));

    expect(await feeXlxTracker.stakedAmounts(user3.address)).eq(toWei(3428.75, 16));
    expect(await feeXlxTracker.depositBalances(user3.address, xlx.address)).eq(toWei(3428.75, 16));

    expect(await stakedXlxTracker.stakedAmounts(user3.address)).eq(toWei(3428.75, 16));
    expect(await stakedXlxTracker.depositBalances(user3.address, feeXlxTracker.address)).eq(
      toWei(3428.75, 16),
    );

    await expect(stakedXlx.connect(user3).transfer(user1.address, toWei(492, 17))).to.be.revertedWith(
      "RewardTracker: _amount exceeds stakedAmount",
    );

    expect(await avax.balanceOf(user1.address)).eq(0);

    await rewardRouter.connect(user1).unstakeAndRedeemXlx(
      avax.address,
      toWei(2500, 17),
      "790000000000000000", // 0.83
      user1.address,
    );

    expect(await avax.balanceOf(user1.address)).eq("793650793650793650");

    await usdg.addVault(xlxManager.address);

    expect(await avax.balanceOf(user3.address)).eq("0");

    await rewardRouter.connect(user3).unstakeAndRedeemXlx(
      avax.address,
      toWei(3428.75, 16),
      "160000000000000000", // 0.16
      user3.address,
    );

    expect(await avax.balanceOf(user3.address)).eq("183973908730158730");
  });

  it("FeeXlx", async () => {
    await avax.mint(feeXlxDistributor.address, toWei(100, 18));
    await feeXlxDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await avax.mint(user1.address, toWei(1, 18));
    await avax.connect(user1).approve(xlxManager.address, toWei(1, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeXlx(avax.address, toWei(1, 18), toWei(280, 18), toWei(280, 18));

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await feeXlxTracker.depositBalances(user1.address, xlx.address)).eq(toWei(28428.75, 16));

    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await stakedXlxTracker.depositBalances(user1.address, feeXlxTracker.address)).eq(
      toWei(28428.75, 16),
    );

    await expect(
      xlxBalance.connect(user2).transferFrom(user1.address, user3.address, toWei(28428.75, 16)),
    ).to.be.revertedWith("XlxBalance: transfer amount exceeds allowance");

    await xlxBalance.connect(user1).approve(user2.address, toWei(28428.75, 16));

    await expect(
      xlxBalance.connect(user2).transferFrom(user1.address, user3.address, toWei(28428.75, 16)),
    ).to.be.revertedWith("XlxBalance: cooldown duration not yet passed");

    await advanceTimeAndBlock(24 * 60 * 60 + 10);

    await expect(
      xlxBalance.connect(user2).transferFrom(user1.address, user3.address, toWei(28428.75, 16)),
    ).to.be.revertedWith("RewardTracker: transfer amount exceeds allowance");

    await timelock.signalSetHandler(stakedXlxTracker.address, xlxBalance.address, true);
    await advanceTimeAndBlock(24 * 60 * 60);
    await timelock.setHandler(stakedXlxTracker.address, xlxBalance.address, true);

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await feeXlxTracker.depositBalances(user1.address, xlx.address)).eq(toWei(28428.75, 16));

    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await stakedXlxTracker.depositBalances(user1.address, feeXlxTracker.address)).eq(
      toWei(28428.75, 16),
    );
    expect(await stakedXlxTracker.balanceOf(user1.address)).eq(toWei(28428.75, 16));

    expect(await feeXlxTracker.stakedAmounts(user3.address)).eq(0);
    expect(await feeXlxTracker.depositBalances(user3.address, xlx.address)).eq(0);

    expect(await stakedXlxTracker.stakedAmounts(user3.address)).eq(0);
    expect(await stakedXlxTracker.depositBalances(user3.address, feeXlxTracker.address)).eq(0);
    expect(await stakedXlxTracker.balanceOf(user3.address)).eq(0);

    await xlxBalance.connect(user2).transferFrom(user1.address, user3.address, toWei(28428.75, 16));

    expect(await feeXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await feeXlxTracker.depositBalances(user1.address, xlx.address)).eq(toWei(28428.75, 16));

    expect(await stakedXlxTracker.stakedAmounts(user1.address)).eq(toWei(28428.75, 16));
    expect(await stakedXlxTracker.depositBalances(user1.address, feeXlxTracker.address)).eq(
      toWei(28428.75, 16),
    );
    expect(await stakedXlxTracker.balanceOf(user1.address)).eq(0);

    expect(await feeXlxTracker.stakedAmounts(user3.address)).eq(0);
    expect(await feeXlxTracker.depositBalances(user3.address, xlx.address)).eq(0);

    expect(await stakedXlxTracker.stakedAmounts(user3.address)).eq(0);
    expect(await stakedXlxTracker.depositBalances(user3.address, feeXlxTracker.address)).eq(0);
    expect(await stakedXlxTracker.balanceOf(user3.address)).eq(toWei(28428.75, 16));

    await expect(
      rewardRouter.connect(user1).unstakeAndRedeemXlx(avax.address, toWei(28428.75, 16), "0", user1.address),
    ).to.be.revertedWith("RewardTracker: burn amount exceeds balance");

    await xlxBalance.connect(user3).approve(user2.address, toWei(3000, 17));

    await expect(
      xlxBalance.connect(user2).transferFrom(user3.address, user1.address, toWei(2992, 17)),
    ).to.be.revertedWith("RewardTracker: transfer amount exceeds balance");

    await xlxBalance.connect(user2).transferFrom(user3.address, user1.address, toWei(28428.75, 16));

    expect(await avax.balanceOf(user1.address)).eq(0);

    await rewardRouter
      .connect(user1)
      .unstakeAndRedeemXlx(avax.address, toWei(28428.75, 16), "0", user1.address);

    expect(await avax.balanceOf(user1.address)).eq("900243750000000000");
  });
});
