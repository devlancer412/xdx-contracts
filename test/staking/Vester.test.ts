import {
  XDX,
  EsXDX,
  MintableBaseToken,
  RewardTracker,
  RewardDistributor,
  RewardRouterV2,
  Vester,
  BonusDistributor,
  XDX__factory,
  EsXDX__factory,
  RewardRouterV2__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { advanceTimeAndBlock, getTime, Ship, toWei } from "../../utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let xdx: XDX;
let esXdx: EsXDX;
let bnXdx: MintableBaseToken;
let xdxVester: Vester;
let rewardRouter: RewardRouterV2;
let stakedXdxTracker: RewardTracker;
let stakedXdxDistributor: RewardDistributor;
let bonusXdxTracker: RewardTracker;
let bonusXdxDistributor: BonusDistributor;
let feeXdxTracker: RewardTracker;

let deployer: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let user3: SignerWithAddress;
let user4: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture([
    "xdx",
    "esXdx",
    "bnXdx",
    "xdxVester",
    "rewardRouter",
    "stakedXdxTracker",
    "stakedXdxDistributor",
    "bonusXdxTracker",
    "bonusXdxDistributor",
    "feeXdxTracker",
  ]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("Vester", () => {
  beforeEach(async () => {
    const { accounts, users } = await setup();
    deployer = accounts.deployer;
    user0 = users[0];
    user1 = users[1];
    user2 = users[2];
    user3 = users[3];
    user4 = users[4];

    xdx = await ship.connect(XDX__factory);
    esXdx = await ship.connect(EsXDX__factory);
    rewardRouter = await ship.connect(RewardRouterV2__factory);

    xdxVester = (await ship.connect("XdxVester")) as Vester;
    bnXdx = (await ship.connect("BN_XDX")) as MintableBaseToken;
    stakedXdxTracker = (await ship.connect("StakedXdxTracker")) as RewardTracker;
    stakedXdxDistributor = (await ship.connect("StakedXdxDistributor")) as RewardDistributor;
    bonusXdxTracker = (await ship.connect("BonusXdxTracker")) as RewardTracker;
    bonusXdxDistributor = (await ship.connect("BonusXdxDistributor")) as BonusDistributor;
    feeXdxTracker = (await ship.connect("FeeXdxTracker")) as RewardTracker;

    await esXdx.setMinter(deployer.address, true);
    await xdx.setMinter(deployer.address, true);

    await xdxVester.setHasMaxVestableAmount(false);
  });

  it("inits", async () => {
    expect(await xdxVester.name()).eq("Vested XDX");
    expect(await xdxVester.symbol()).eq("vXDX");
    expect(await xdxVester.vestingDuration()).eq(365 * 24 * 60 * 60);
    expect(await xdxVester.esToken()).eq(esXdx.address);
    expect(await xdxVester.pairToken()).eq(feeXdxTracker.address);
    expect(await xdxVester.claimableToken()).eq(xdx.address);
    expect(await xdxVester.rewardTracker()).eq(stakedXdxTracker.address);
    expect(await xdxVester.hasPairToken()).eq(true);
    expect(await xdxVester.hasRewardTracker()).eq(true);
    expect(await xdxVester.hasMaxVestableAmount()).eq(false);
  });

  it("setTransferredAverageStakedAmounts", async () => {
    await expect(xdxVester.setTransferredAverageStakedAmounts(user0.address, 200)).to.be.revertedWith(
      "Vester: forbidden",
    );

    await xdxVester.setHandler(deployer.address, true);

    expect(await xdxVester.transferredAverageStakedAmounts(user0.address)).eq(0);
    await xdxVester.setTransferredAverageStakedAmounts(user0.address, 200);
    expect(await xdxVester.transferredAverageStakedAmounts(user0.address)).eq(200);
  });

  it("setTransferredCumulativeRewards", async () => {
    await expect(xdxVester.setTransferredCumulativeRewards(user0.address, 200)).to.be.revertedWith(
      "Vester: forbidden",
    );

    await xdxVester.setHandler(deployer.address, true);

    expect(await xdxVester.transferredCumulativeRewards(user0.address)).eq(0);
    await xdxVester.setTransferredCumulativeRewards(user0.address, 200);
    expect(await xdxVester.transferredCumulativeRewards(user0.address)).eq(200);
  });

  it("setCumulativeRewardDeductions", async () => {
    await expect(xdxVester.setCumulativeRewardDeductions(user0.address, 200)).to.be.revertedWith(
      "Vester: forbidden",
    );

    await xdxVester.setHandler(deployer.address, true);

    expect(await xdxVester.cumulativeRewardDeductions(user0.address)).eq(0);
    await xdxVester.setCumulativeRewardDeductions(user0.address, 200);
    expect(await xdxVester.cumulativeRewardDeductions(user0.address)).eq(200);
  });

  it("setBonusRewards", async () => {
    await expect(xdxVester.setBonusRewards(user0.address, 200)).to.be.revertedWith("Vester: forbidden");

    await xdxVester.setHandler(deployer.address, true);

    expect(await xdxVester.bonusRewards(user0.address)).eq(0);
    await xdxVester.setBonusRewards(user0.address, 200);
    expect(await xdxVester.bonusRewards(user0.address)).eq(200);
  });

  it("deposit, claim, withdraw", async () => {
    await esXdx.setMinter(xdxVester.address, true);

    await expect(xdxVester.connect(user0).deposit(0)).to.be.revertedWith("Vester: invalid _amount");

    // await expect(xdxVester.connect(user0).deposit(toWei(1000, 18))).to.be.revertedWith(
    //   "BaseToken: transfer amount exceeds allowance",
    // );

    // await esXdx.connect(user0).approve(xdxVester.address, toWei(1000, 18));

    await expect(xdxVester.connect(user0).deposit(toWei(1000, 18))).to.be.revertedWith(
      "BaseToken: transfer amount exceeds balance",
    );

    expect(await xdxVester.balanceOf(user0.address)).eq(0);
    expect(await xdxVester.getTotalVested(user0.address)).eq(0);
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).eq(0);
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(0);

    await esXdx.mint(user0.address, toWei(1000, 18));
    await xdxVester.connect(user0).deposit(toWei(1000, 18));

    let blockTime = await getTime();

    expect(await xdxVester.balanceOf(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.getTotalVested(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).eq(0);
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(blockTime);

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await xdx.balanceOf(user0.address)).eq(0);
    expect(await xdxVester.balanceOf(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.getTotalVested(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).gt("2730000000000000000"); // 1000 / 365 => ~2.739
    expect(await xdxVester.claimable(user0.address)).lt("2750000000000000000");
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(blockTime);

    await expect(xdxVester.connect(user0).claim()).to.be.revertedWith(
      "BaseToken: transfer amount exceeds balance",
    );

    await xdx.mint(xdxVester.address, toWei(2000, 18));

    await xdxVester.connect(user0).claim();
    blockTime = await getTime();

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await xdx.balanceOf(user0.address)).gt("2730000000000000000");
    expect(await xdx.balanceOf(user0.address)).lt("2750000000000000000");

    let xdxAmount = await xdx.balanceOf(user0.address);
    expect(await xdxVester.balanceOf(user0.address)).eq(toWei(1000, 18).sub(xdxAmount));

    expect(await xdxVester.getTotalVested(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(xdxAmount);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(xdxAmount);
    expect(await xdxVester.claimable(user0.address)).eq(0);
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(blockTime);

    await advanceTimeAndBlock(48 * 60 * 60);

    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(xdxAmount);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(xdxAmount);
    expect(await xdxVester.claimable(user0.address)).gt("5478000000000000000"); // 1000 / 365 * 2 => ~5.479
    expect(await xdxVester.claimable(user0.address)).lt("5480000000000000000");

    await advanceTimeAndBlock((365 / 2 - 1) * 24 * 60 * 60);

    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(xdxAmount);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(xdxAmount);
    expect(await xdxVester.claimable(user0.address)).gt(toWei(502, 18)); // 1000 / 2 => 500
    expect(await xdxVester.claimable(user0.address)).lt(toWei(503, 18));

    await xdxVester.connect(user0).claim();
    blockTime = await getTime();

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await xdx.balanceOf(user0.address)).gt(toWei(505, 18));
    expect(await xdx.balanceOf(user0.address)).lt(toWei(506, 18));

    xdxAmount = await xdx.balanceOf(user0.address);
    expect(await xdxVester.balanceOf(user0.address)).eq(toWei(1000, 18).sub(xdxAmount));

    expect(await xdxVester.getTotalVested(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(xdxAmount);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(xdxAmount);
    expect(await xdxVester.claimable(user0.address)).eq(0);
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(blockTime);

    await advanceTimeAndBlock(24 * 60 * 60);

    // vesting rate should be the same even after claiming
    expect(await xdxVester.claimable(user0.address)).gt("2730000000000000000"); // 1000 / 365 => ~2.739
    expect(await xdxVester.claimable(user0.address)).lt("2750000000000000000");

    await esXdx.mint(user0.address, toWei(500, 18));
    await esXdx.connect(user0).approve(xdxVester.address, toWei(500, 18));
    await xdxVester.connect(user0).deposit(toWei(500, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await xdxVester.claimable(user0.address)).gt("6840000000000000000"); // 1000 / 365 + 1500 / 365 => 6.849
    expect(await xdxVester.claimable(user0.address)).lt("6860000000000000000");

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await xdx.balanceOf(user0.address)).eq(xdxAmount);

    await xdxVester.connect(user0).withdraw();

    expect(await esXdx.balanceOf(user0.address)).gt(toWei(987, 18));
    expect(await esXdx.balanceOf(user0.address)).lt(toWei(988, 18));
    expect(await xdx.balanceOf(user0.address)).gt(toWei(512, 18));
    expect(await xdx.balanceOf(user0.address)).lt(toWei(513, 18));

    expect(await xdxVester.balanceOf(user0.address)).eq(0);
    expect(await xdxVester.getTotalVested(user0.address)).eq(0);
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).eq(0);
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(0);

    await esXdx.connect(user0).approve(xdxVester.address, toWei(1000, 18));
    await esXdx.mint(user0.address, toWei(1000, 18));
    await xdxVester.connect(user0).deposit(toWei(1000, 18));
    blockTime = await getTime();

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await xdxVester.balanceOf(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.getTotalVested(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).gt("2730000000000000000"); // 1000 / 365 => ~2.739
    expect(await xdxVester.claimable(user0.address)).lt("2750000000000000000");
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(blockTime);

    await xdxVester.connect(user0).claim();
  });

  it("depositForAccount, claimForAccount", async () => {
    await esXdx.setMinter(xdxVester.address, true);
    await xdxVester.setHandler(deployer.address, true);

    await esXdx.connect(user0).approve(xdxVester.address, toWei(1000, 18));

    expect(await xdxVester.balanceOf(user0.address)).eq(0);
    expect(await xdxVester.getTotalVested(user0.address)).eq(0);
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).eq(0);
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(0);

    await esXdx.mint(user0.address, toWei(1000, 18));

    await expect(
      xdxVester.connect(user2).depositForAccount(user0.address, toWei(1000, 18)),
    ).to.be.revertedWith("Vester: forbidden");

    await xdxVester.setHandler(user2.address, true);
    await xdxVester.connect(user2).depositForAccount(user0.address, toWei(1000, 18));

    let blockTime = await getTime();

    expect(await xdxVester.balanceOf(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.getTotalVested(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).eq(0);
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(blockTime);

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await xdx.balanceOf(user0.address)).eq(0);
    expect(await xdxVester.balanceOf(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.getTotalVested(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).gt("2730000000000000000"); // 1000 / 365 => ~2.739
    expect(await xdxVester.claimable(user0.address)).lt("2750000000000000000");
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(blockTime);

    await expect(xdxVester.connect(user0).claim()).to.be.revertedWith(
      "BaseToken: transfer amount exceeds balance",
    );

    await xdx.mint(xdxVester.address, toWei(2000, 18));

    await expect(xdxVester.connect(user3).claimForAccount(user0.address, user4.address)).to.be.revertedWith(
      "Vester: forbidden",
    );

    await xdxVester.setHandler(user3.address, true);

    await xdxVester.connect(user3).claimForAccount(user0.address, user4.address);
    blockTime = await getTime();

    expect(await esXdx.balanceOf(user4.address)).eq(0);
    expect(await xdx.balanceOf(user4.address)).gt("2730000000000000000");
    expect(await xdx.balanceOf(user4.address)).lt("2750000000000000000");

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await xdx.balanceOf(user0.address)).eq(0);
    expect(await xdxVester.balanceOf(user0.address)).gt(toWei(996, 18));
    expect(await xdxVester.balanceOf(user0.address)).lt(toWei(998, 18));
    expect(await xdxVester.getTotalVested(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).gt("2730000000000000000");
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).lt("2750000000000000000");
    expect(await xdxVester.claimedAmounts(user0.address)).gt("2730000000000000000");
    expect(await xdxVester.claimedAmounts(user0.address)).lt("2750000000000000000");
    expect(await xdxVester.claimable(user0.address)).eq(0);
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(blockTime);
  });

  it("handles multiple deposits", async () => {
    await esXdx.setMinter(xdxVester.address, true);
    await xdxVester.setHandler(deployer.address, true);

    await esXdx.connect(user0).approve(xdxVester.address, toWei(1000, 18));

    expect(await xdxVester.balanceOf(user0.address)).eq(0);
    expect(await xdxVester.getTotalVested(user0.address)).eq(0);
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).eq(0);
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(0);

    await esXdx.mint(user0.address, toWei(1000, 18));
    await xdxVester.connect(user0).deposit(toWei(1000, 18));

    let blockTime = await getTime();

    expect(await xdxVester.balanceOf(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.getTotalVested(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).eq(0);
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(blockTime);

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await xdx.balanceOf(user0.address)).eq(0);
    expect(await xdxVester.balanceOf(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.getTotalVested(user0.address)).eq(toWei(1000, 18));
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).gt("2730000000000000000"); // 1000 / 365 => ~2.739
    expect(await xdxVester.claimable(user0.address)).lt("2750000000000000000");
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(blockTime);

    await expect(xdxVester.connect(user0).claim()).to.be.revertedWith(
      "BaseToken: transfer amount exceeds balance",
    );

    await xdx.mint(xdxVester.address, toWei(2000, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await xdxVester.balanceOf(user0.address)).eq(toWei(1000, 18));

    await esXdx.mint(user0.address, toWei(500, 18));
    await esXdx.connect(user0).approve(xdxVester.address, toWei(500, 18));
    await xdxVester.connect(user0).deposit(toWei(500, 18));
    blockTime = await getTime();

    expect(await xdxVester.balanceOf(user0.address)).gt(toWei(1494, 18));
    expect(await xdxVester.balanceOf(user0.address)).lt(toWei(1496, 18));
    expect(await xdxVester.getTotalVested(user0.address)).eq(toWei(1500, 18));
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).gt("5470000000000000000"); // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).lt("5490000000000000000"); // 5.49
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).gt("5470000000000000000");
    expect(await xdxVester.claimable(user0.address)).lt("5490000000000000000");
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(blockTime);

    await xdxVester.connect(user0).withdraw();

    expect(await esXdx.balanceOf(user0.address)).gt(toWei(1494, 18));
    expect(await esXdx.balanceOf(user0.address)).lt(toWei(1496, 18));
    expect(await xdx.balanceOf(user0.address)).gt("5470000000000000000");
    expect(await xdx.balanceOf(user0.address)).lt("5490000000000000000");
    expect(await xdxVester.balanceOf(user0.address)).eq(0);
    expect(await xdxVester.getTotalVested(user0.address)).eq(0);
    expect(await xdxVester.cumulativeClaimAmounts(user0.address)).eq(0); // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await xdxVester.claimedAmounts(user0.address)).eq(0);
    expect(await xdxVester.claimable(user0.address)).eq(0);
    expect(await xdxVester.pairAmounts(user0.address)).eq(0);
    expect(await xdxVester.lastVestingTimes(user0.address)).eq(0);
  });

  it("handles pairing", async () => {
    await stakedXdxTracker.setInPrivateTransferMode(true);
    await stakedXdxTracker.setInPrivateStakingMode(true);
    await bonusXdxTracker.setInPrivateTransferMode(true);
    await bonusXdxTracker.setInPrivateStakingMode(true);
    await bonusXdxTracker.setInPrivateClaimingMode(true);
    await feeXdxTracker.setInPrivateTransferMode(true);
    await feeXdxTracker.setInPrivateStakingMode(true);

    await esXdx.setMinter(deployer.address, true);
    await esXdx.mint(stakedXdxDistributor.address, toWei(50000 * 12, 18));
    await stakedXdxDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esXdx per second

    // allow rewardRouter to stake in stakedXdxTracker
    await stakedXdxTracker.setHandler(rewardRouter.address, true);
    // allow bonusXdxTracker to stake stakedXdxTracker
    await stakedXdxTracker.setHandler(bonusXdxTracker.address, true);
    // allow rewardRouter to stake in bonusXdxTracker
    await bonusXdxTracker.setHandler(rewardRouter.address, true);
    // allow bonusXdxTracker to stake feeXdxTracker
    await bonusXdxTracker.setHandler(feeXdxTracker.address, true);
    await bonusXdxDistributor.setBonusMultiplier(10000);
    // allow rewardRouter to stake in feeXdxTracker
    await feeXdxTracker.setHandler(rewardRouter.address, true);
    // allow stakedXdxTracker to stake esXdx
    await esXdx.setHandler(stakedXdxTracker.address, true);
    // allow feeXdxTracker to stake bnXdx
    await bnXdx.setHandler(feeXdxTracker.address, true);
    // allow rewardRouter to burn bnXdx
    await bnXdx.setMinter(rewardRouter.address, true);

    await esXdx.setMinter(xdxVester.address, true);
    await xdxVester.setHandler(deployer.address, true);

    expect(await xdxVester.name()).eq("Vested XDX");
    expect(await xdxVester.symbol()).eq("vXDX");
    expect(await xdxVester.vestingDuration()).eq(365 * 24 * 60 * 60);
    expect(await xdxVester.esToken()).eq(esXdx.address);
    expect(await xdxVester.pairToken()).eq(feeXdxTracker.address);
    expect(await xdxVester.claimableToken()).eq(xdx.address);
    expect(await xdxVester.rewardTracker()).eq(stakedXdxTracker.address);
    expect(await xdxVester.hasPairToken()).eq(true);
    expect(await xdxVester.hasRewardTracker()).eq(true);
    expect(await xdxVester.hasMaxVestableAmount()).eq(false);

    // allow vester to transfer feeXdxTracker tokens
    await feeXdxTracker.setHandler(xdxVester.address, true);
    // allow vester to transfer esXdx tokens
    await esXdx.setHandler(xdxVester.address, true);

    await xdx.mint(xdxVester.address, toWei(2000, 18));

    await xdx.mint(user0.address, toWei(1000, 18));
    await xdx.mint(user1.address, toWei(500, 18));
    await xdx.connect(user0).approve(stakedXdxTracker.address, toWei(1000, 18));
    await xdx.connect(user1).approve(stakedXdxTracker.address, toWei(500, 18));

    await rewardRouter.connect(user0).stakeXdx(toWei(1000, 18));
    await rewardRouter.connect(user1).stakeXdx(toWei(500, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await stakedXdxTracker.claimable(user0.address)).gt(toWei(1190, 18));
    expect(await stakedXdxTracker.claimable(user0.address)).lt(toWei(1191, 18));
    expect(await stakedXdxTracker.claimable(user1.address)).gt(toWei(594, 18));
    expect(await stakedXdxTracker.claimable(user1.address)).lt(toWei(596, 18));

    expect(await xdxVester.getMaxVestableAmount(user0.address)).eq(0);
    expect(await xdxVester.getMaxVestableAmount(user1.address)).eq(0);

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await esXdx.balanceOf(user1.address)).eq(0);
    expect(await esXdx.balanceOf(user2.address)).eq(0);
    expect(await esXdx.balanceOf(user3.address)).eq(0);

    await stakedXdxTracker.connect(user0).claim(user2.address);
    await stakedXdxTracker.connect(user1).claim(user3.address);

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await esXdx.balanceOf(user1.address)).eq(0);
    expect(await esXdx.balanceOf(user2.address)).gt(toWei(1190, 18));
    expect(await esXdx.balanceOf(user2.address)).lt(toWei(1191, 18));
    expect(await esXdx.balanceOf(user3.address)).gt(toWei(594, 18));
    expect(await esXdx.balanceOf(user3.address)).lt(toWei(596, 18));

    expect(await xdxVester.getMaxVestableAmount(user0.address)).gt(toWei(1190, 18));
    expect(await xdxVester.getMaxVestableAmount(user0.address)).lt(toWei(1191, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).gt(toWei(594, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).lt(toWei(596, 18));
    expect(await xdxVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await xdxVester.getMaxVestableAmount(user3.address)).eq(0);

    expect(await xdxVester.getPairAmount(user0.address, toWei(1, 18))).gt("830000000000000000"); // 0.83, 1000 / 1190 => ~0.84
    expect(await xdxVester.getPairAmount(user0.address, toWei(1, 18))).lt("850000000000000000"); // 0.85
    expect(await xdxVester.getPairAmount(user1.address, toWei(1, 18))).gt("830000000000000000"); // 0.83, 500 / 595 => ~0.84
    expect(await xdxVester.getPairAmount(user1.address, toWei(1, 18))).lt("850000000000000000"); // 0.85
    expect(await xdxVester.getPairAmount(user2.address, toWei(1, 18))).eq(0);
    expect(await xdxVester.getPairAmount(user3.address, toWei(1, 18))).eq(0);

    await advanceTimeAndBlock(24 * 60 * 60);

    await stakedXdxTracker.connect(user0).claim(user2.address);
    await stakedXdxTracker.connect(user1).claim(user3.address);

    expect(await xdxVester.getMaxVestableAmount(user0.address)).gt(toWei(2380, 18));
    expect(await xdxVester.getMaxVestableAmount(user0.address)).lt(toWei(2382, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).gt(toWei(1189, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).lt(toWei(1191, 18));

    expect(await xdxVester.getPairAmount(user0.address, toWei(1, 18))).gt("410000000000000000"); // 0.41, 1000 / 2380 => ~0.42
    expect(await xdxVester.getPairAmount(user0.address, toWei(1, 18))).lt("430000000000000000"); // 0.43
    expect(await xdxVester.getPairAmount(user1.address, toWei(1, 18))).gt("410000000000000000"); // 0.41, 1000 / 2380 => ~0.42
    expect(await xdxVester.getPairAmount(user1.address, toWei(1, 18))).lt("430000000000000000"); // 0.43

    await esXdx.mint(user0.address, toWei(2385, 18));
    await expect(xdxVester.connect(user0).deposit(toWei(2385, 18))).to.be.revertedWith(
      "RewardTracker: transfer amount exceeds balance",
    );

    await xdx.mint(user0.address, toWei(500, 18));
    await xdx.connect(user0).approve(stakedXdxTracker.address, toWei(500, 18));
    await rewardRouter.connect(user0).stakeXdx(toWei(500, 18));

    await xdxVester.setHasMaxVestableAmount(true);
    await expect(xdxVester.connect(user0).deposit(toWei(2385, 18))).to.be.revertedWith(
      "Vester: max vestable amount exceeded",
    );

    await xdx.mint(user2.address, toWei(1, 18));
    await expect(xdxVester.connect(user2).deposit(toWei(1, 18))).to.be.revertedWith(
      "Vester: max vestable amount exceeded",
    );

    expect(await esXdx.balanceOf(user0.address)).eq(toWei(2385, 18));
    expect(await esXdx.balanceOf(xdxVester.address)).eq(0);
    expect(await feeXdxTracker.balanceOf(user0.address)).eq(toWei(1500, 18));
    expect(await feeXdxTracker.balanceOf(xdxVester.address)).eq(0);

    await xdxVester.connect(user0).deposit(toWei(2380, 18));

    expect(await esXdx.balanceOf(user0.address)).eq(toWei(5, 18));
    expect(await esXdx.balanceOf(xdxVester.address)).eq(toWei(2380, 18));
    expect(await feeXdxTracker.balanceOf(user0.address)).gt(toWei(499, 18));
    expect(await feeXdxTracker.balanceOf(user0.address)).lt(toWei(501, 18));
    expect(await feeXdxTracker.balanceOf(xdxVester.address)).gt(toWei(999, 18));
    expect(await feeXdxTracker.balanceOf(xdxVester.address)).lt(toWei(1001, 18));

    await rewardRouter.connect(user1).unstakeXdx(toWei(499, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    await stakedXdxTracker.connect(user0).claim(user2.address);
    await stakedXdxTracker.connect(user1).claim(user3.address);

    expect(await xdxVester.getMaxVestableAmount(user0.address)).gt(toWei(4164, 18));
    expect(await xdxVester.getMaxVestableAmount(user0.address)).lt(toWei(4166, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).gt(toWei(1190, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).lt(toWei(1192, 18));

    // (1000 * 2380 / 4164) + (1500 * 1784 / 4164) => 1214.21709894
    // 1214.21709894 / 4164 => ~0.29

    expect(await xdxVester.getPairAmount(user0.address, toWei(1, 18))).gt("280000000000000000"); // 0.28
    expect(await xdxVester.getPairAmount(user0.address, toWei(1, 18))).lt("300000000000000000"); // 0.30
    expect(await xdxVester.getPairAmount(user1.address, toWei(1, 18))).gt("410000000000000000"); // 0.41, 1000 / 2380 => ~0.42
    expect(await xdxVester.getPairAmount(user1.address, toWei(1, 18))).lt("430000000000000000"); // 0.43

    await advanceTimeAndBlock(30 * 24 * 60 * 60);

    await xdxVester.connect(user0).withdraw();

    expect(await feeXdxTracker.balanceOf(user0.address)).eq(toWei(1500, 18));
    expect(await xdx.balanceOf(user0.address)).gt(toWei(201, 18)); // 2380 / 12 = ~198
    expect(await xdx.balanceOf(user0.address)).lt(toWei(203, 18));
    expect(await esXdx.balanceOf(user0.address)).gt(toWei(2182, 18)); // 5 + 2380 - 202  = 2183
    expect(await esXdx.balanceOf(user0.address)).lt(toWei(2183, 18));
  });

  it("handles existing pair tokens", async () => {
    await stakedXdxTracker.setInPrivateTransferMode(true);
    await stakedXdxTracker.setInPrivateStakingMode(true);
    await bonusXdxTracker.setInPrivateTransferMode(true);
    await bonusXdxTracker.setInPrivateStakingMode(true);
    await bonusXdxTracker.setInPrivateClaimingMode(true);
    await feeXdxTracker.setInPrivateTransferMode(true);
    await feeXdxTracker.setInPrivateStakingMode(true);

    await esXdx.setMinter(deployer.address, true);
    await esXdx.mint(stakedXdxDistributor.address, toWei(50000 * 12, 18));
    await stakedXdxDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esXdx per second

    // allow rewardRouter to stake in stakedXdxTracker
    await stakedXdxTracker.setHandler(rewardRouter.address, true);
    // allow bonusXdxTracker to stake stakedXdxTracker
    await stakedXdxTracker.setHandler(bonusXdxTracker.address, true);
    // allow rewardRouter to stake in bonusXdxTracker
    await bonusXdxTracker.setHandler(rewardRouter.address, true);
    // allow bonusXdxTracker to stake feeXdxTracker
    await bonusXdxTracker.setHandler(feeXdxTracker.address, true);
    await bonusXdxDistributor.setBonusMultiplier(10000);
    // allow rewardRouter to stake in feeXdxTracker
    await feeXdxTracker.setHandler(rewardRouter.address, true);
    // allow stakedXdxTracker to stake esXdx
    await esXdx.setHandler(stakedXdxTracker.address, true);
    // allow feeXdxTracker to stake bnXdx
    await bnXdx.setHandler(feeXdxTracker.address, true);
    // allow rewardRouter to burn bnXdx
    await bnXdx.setMinter(rewardRouter.address, true);

    await esXdx.setMinter(xdxVester.address, true);
    await xdxVester.setHandler(deployer.address, true);

    expect(await xdxVester.name()).eq("Vested XDX");
    expect(await xdxVester.symbol()).eq("vXDX");
    expect(await xdxVester.vestingDuration()).eq(365 * 24 * 60 * 60);
    expect(await xdxVester.esToken()).eq(esXdx.address);
    expect(await xdxVester.pairToken()).eq(feeXdxTracker.address);
    expect(await xdxVester.claimableToken()).eq(xdx.address);
    expect(await xdxVester.rewardTracker()).eq(stakedXdxTracker.address);
    expect(await xdxVester.hasPairToken()).eq(true);
    expect(await xdxVester.hasRewardTracker()).eq(true);
    expect(await xdxVester.hasMaxVestableAmount()).eq(false);

    // allow vester to transfer feeXdxTracker tokens
    await feeXdxTracker.setHandler(xdxVester.address, true);
    // allow vester to transfer esXdx tokens
    await esXdx.setHandler(xdxVester.address, true);

    await xdx.mint(xdxVester.address, toWei(2000, 18));

    await xdx.mint(user0.address, toWei(1000, 18));
    await xdx.mint(user1.address, toWei(500, 18));
    await xdx.connect(user0).approve(stakedXdxTracker.address, toWei(1000, 18));
    await xdx.connect(user1).approve(stakedXdxTracker.address, toWei(500, 18));

    await rewardRouter.connect(user0).stakeXdx(toWei(1000, 18));
    await rewardRouter.connect(user1).stakeXdx(toWei(500, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await stakedXdxTracker.claimable(user0.address)).gt(toWei(1190, 18));
    expect(await stakedXdxTracker.claimable(user0.address)).lt(toWei(1191, 18));
    expect(await stakedXdxTracker.claimable(user1.address)).gt(toWei(594, 18));
    expect(await stakedXdxTracker.claimable(user1.address)).lt(toWei(596, 18));

    expect(await xdxVester.getMaxVestableAmount(user0.address)).eq(0);
    expect(await xdxVester.getMaxVestableAmount(user1.address)).eq(0);

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await esXdx.balanceOf(user1.address)).eq(0);
    expect(await esXdx.balanceOf(user2.address)).eq(0);
    expect(await esXdx.balanceOf(user3.address)).eq(0);

    await stakedXdxTracker.connect(user0).claim(user2.address);
    await stakedXdxTracker.connect(user1).claim(user3.address);

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await esXdx.balanceOf(user1.address)).eq(0);
    expect(await esXdx.balanceOf(user2.address)).gt(toWei(1190, 18));
    expect(await esXdx.balanceOf(user2.address)).lt(toWei(1191, 18));
    expect(await esXdx.balanceOf(user3.address)).gt(toWei(594, 18));
    expect(await esXdx.balanceOf(user3.address)).lt(toWei(596, 18));

    expect(await xdxVester.getMaxVestableAmount(user0.address)).gt(toWei(1190, 18));
    expect(await xdxVester.getMaxVestableAmount(user0.address)).lt(toWei(1191, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).gt(toWei(594, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).lt(toWei(596, 18));
    expect(await xdxVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await xdxVester.getMaxVestableAmount(user3.address)).eq(0);

    expect(await xdxVester.getPairAmount(user0.address, toWei(1, 18))).gt("830000000000000000"); // 0.83, 1000 / 1190 => ~0.84
    expect(await xdxVester.getPairAmount(user0.address, toWei(1, 18))).lt("850000000000000000"); // 0.85
    expect(await xdxVester.getPairAmount(user1.address, toWei(1, 18))).gt("830000000000000000"); // 0.83, 500 / 595 => ~0.84
    expect(await xdxVester.getPairAmount(user1.address, toWei(1, 18))).lt("850000000000000000"); // 0.85
    expect(await xdxVester.getPairAmount(user2.address, toWei(1, 18))).eq(0);
    expect(await xdxVester.getPairAmount(user3.address, toWei(1, 18))).eq(0);

    await advanceTimeAndBlock(24 * 60 * 60);

    await stakedXdxTracker.connect(user0).claim(user2.address);
    await stakedXdxTracker.connect(user1).claim(user3.address);

    expect(await esXdx.balanceOf(user2.address)).gt(toWei(2380, 18));
    expect(await esXdx.balanceOf(user2.address)).lt(toWei(2382, 18));
    expect(await esXdx.balanceOf(user3.address)).gt(toWei(1189, 18));
    expect(await esXdx.balanceOf(user3.address)).lt(toWei(1191, 18));

    expect(await xdxVester.getMaxVestableAmount(user0.address)).gt(toWei(2380, 18));
    expect(await xdxVester.getMaxVestableAmount(user0.address)).lt(toWei(2382, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).gt(toWei(1189, 18));
    expect(await xdxVester.getMaxVestableAmount(user1.address)).lt(toWei(1191, 18));

    expect(await xdxVester.getPairAmount(user0.address, toWei(1, 18))).gt("410000000000000000"); // 0.41, 1000 / 2380 => ~0.42
    expect(await xdxVester.getPairAmount(user0.address, toWei(1, 18))).lt("430000000000000000"); // 0.43
    expect(await xdxVester.getPairAmount(user1.address, toWei(1, 18))).gt("410000000000000000"); // 0.41, 1000 / 2380 => ~0.42
    expect(await xdxVester.getPairAmount(user1.address, toWei(1, 18))).lt("430000000000000000"); // 0.43

    expect(await xdxVester.getPairAmount(user0.address, toWei(2380, 18))).gt(toWei(999, 18));
    expect(await xdxVester.getPairAmount(user0.address, toWei(2380, 18))).lt(toWei(1000, 18));
    expect(await xdxVester.getPairAmount(user1.address, toWei(1189, 18))).gt(toWei(499, 18));
    expect(await xdxVester.getPairAmount(user1.address, toWei(1189, 18))).lt(toWei(500, 18));

    expect(await feeXdxTracker.balanceOf(user0.address)).eq(toWei(1000, 18));
    await esXdx.mint(user0.address, toWei(2380, 18));
    await xdxVester.connect(user0).deposit(toWei(2380, 18));

    expect(await feeXdxTracker.balanceOf(user0.address)).gt(0);
    expect(await feeXdxTracker.balanceOf(user0.address)).lt(toWei(1, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await stakedXdxTracker.claimable(user0.address)).gt(toWei(1190, 18));
    expect(await stakedXdxTracker.claimable(user0.address)).lt(toWei(1191, 18));

    expect(await xdxVester.getMaxVestableAmount(user0.address)).gt(toWei(2380, 18));
    expect(await xdxVester.getMaxVestableAmount(user0.address)).lt(toWei(2382, 18));

    await stakedXdxTracker.connect(user0).claim(user2.address);

    expect(await xdxVester.getMaxVestableAmount(user0.address)).gt(toWei(3571, 18));
    expect(await xdxVester.getMaxVestableAmount(user0.address)).lt(toWei(3572, 18));

    expect(await xdxVester.getPairAmount(user0.address, toWei(3570, 18))).gt(toWei(999, 18));
    expect(await xdxVester.getPairAmount(user0.address, toWei(3570, 18))).lt(toWei(1000, 18));

    const feeXdxTrackerBalance = await feeXdxTracker.balanceOf(user0.address);

    await esXdx.mint(user0.address, toWei(1190, 18));
    await xdxVester.connect(user0).deposit(toWei(1190, 18));

    expect(feeXdxTrackerBalance).eq(await feeXdxTracker.balanceOf(user0.address));

    await expect(rewardRouter.connect(user0).unstakeXdx(toWei(2, 18))).to.be.revertedWith(
      "RewardTracker: burn amount exceeds balance",
    );

    await xdxVester.connect(user0).withdraw();

    await rewardRouter.connect(user0).unstakeXdx(toWei(2, 18));
  });
});
