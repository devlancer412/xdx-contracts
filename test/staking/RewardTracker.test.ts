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

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let xdx: XDX;
let esXdx: EsXDX;
let stakedXdxTracker: RewardTracker;
let stakedXdxDistributor: RewardDistributor;

let deployer: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let user3: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["xdx", "esXdx", "stakedXdxTracker", "stakedXdxDistributor"]);

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
describe("RewardTracker", () => {
  beforeEach(async () => {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    user0 = users[0];
    user1 = users[1];
    user2 = users[2];
    user3 = users[3];

    xdx = await ship.connect(XDX__factory);
    esXdx = await ship.connect(EsXDX__factory);

    stakedXdxTracker = (await ship.connect("StakedXdxTracker")) as RewardTracker;
    stakedXdxDistributor = (await ship.connect("StakedXdxDistributor")) as RewardDistributor;
  });

  it("inits", async () => {
    expect(await stakedXdxTracker.isInitialized()).eq(true);
    expect(await stakedXdxTracker.isDepositToken(deployer.address)).eq(false);
    expect(await stakedXdxTracker.isDepositToken(xdx.address)).eq(true);
    expect(await stakedXdxTracker.isDepositToken(esXdx.address)).eq(true);
    expect(await stakedXdxTracker.distributor()).eq(stakedXdxDistributor.address);
    expect(await stakedXdxTracker.distributor()).eq(stakedXdxDistributor.address);
    expect(await stakedXdxTracker.rewardToken()).eq(esXdx.address);

    await expect(
      stakedXdxTracker.initialize([xdx.address, esXdx.address], stakedXdxDistributor.address),
    ).to.be.revertedWith("RewardTracker: already initialized");
  });

  it("setDepositToken", async () => {
    await expect(stakedXdxTracker.connect(user0).setDepositToken(user1.address, true)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await stakedXdxTracker.setGov(user0.address);

    expect(await stakedXdxTracker.isDepositToken(user1.address)).eq(false);
    await stakedXdxTracker.connect(user0).setDepositToken(user1.address, true);
    expect(await stakedXdxTracker.isDepositToken(user1.address)).eq(true);
    await stakedXdxTracker.connect(user0).setDepositToken(user1.address, false);
    expect(await stakedXdxTracker.isDepositToken(user1.address)).eq(false);
  });

  it("setInPrivateTransferMode", async () => {
    await expect(stakedXdxTracker.connect(user0).setInPrivateTransferMode(false)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await stakedXdxTracker.setGov(user0.address);

    expect(await stakedXdxTracker.inPrivateTransferMode()).eq(true);
    await stakedXdxTracker.connect(user0).setInPrivateTransferMode(false);
    expect(await stakedXdxTracker.inPrivateTransferMode()).eq(false);
  });

  it("setInPrivateStakingMode", async () => {
    await expect(stakedXdxTracker.connect(user0).setInPrivateStakingMode(false)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await stakedXdxTracker.setGov(user0.address);

    expect(await stakedXdxTracker.inPrivateStakingMode()).eq(true);
    await stakedXdxTracker.connect(user0).setInPrivateStakingMode(false);
    expect(await stakedXdxTracker.inPrivateStakingMode()).eq(false);
  });

  it("setHandler", async () => {
    await expect(stakedXdxTracker.connect(user0).setHandler(user1.address, true)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await stakedXdxTracker.setGov(user0.address);

    expect(await stakedXdxTracker.isHandler(user1.address)).eq(false);
    await stakedXdxTracker.connect(user0).setHandler(user1.address, true);
    expect(await stakedXdxTracker.isHandler(user1.address)).eq(true);
  });

  it("withdrawToken", async () => {
    await xdx.setMinter(deployer.address, true);
    await xdx.mint(stakedXdxTracker.address, 2000);
    await expect(
      stakedXdxTracker.connect(user0).withdrawToken(xdx.address, user1.address, 2000),
    ).to.be.revertedWith("Governable: forbidden");

    await stakedXdxTracker.setGov(user0.address);

    expect(await xdx.balanceOf(user1.address)).eq(0);
    await stakedXdxTracker.connect(user0).withdrawToken(xdx.address, user1.address, 2000);
    expect(await xdx.balanceOf(user1.address)).eq(2000);
  });

  it("stake, unstake, claim", async () => {
    await esXdx.setMinter(deployer.address, true);
    await esXdx.mint(stakedXdxDistributor.address, toWei(50000, 18));
    await stakedXdxDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esXdx per second
    await xdx.setMinter(deployer.address, true);
    await xdx.mint(user0.address, toWei(1000, 18));

    await stakedXdxTracker.setInPrivateStakingMode(true);
    await expect(stakedXdxTracker.connect(user0).stake(xdx.address, toWei(1000, 18))).to.be.revertedWith(
      "RewardTracker: action not enabled",
    );

    await stakedXdxTracker.setInPrivateStakingMode(false);

    await expect(stakedXdxTracker.connect(user0).stake(user1.address, 0)).to.be.revertedWith(
      "RewardTracker: invalid _amount",
    );

    await expect(stakedXdxTracker.connect(user0).stake(user1.address, toWei(1000, 18))).to.be.revertedWith(
      "RewardTracker: invalid _depositToken",
    );

    await expect(stakedXdxTracker.connect(user0).stake(xdx.address, toWei(1000, 18))).to.be.revertedWith(
      "BaseToken: transfer amount exceeds allowance",
    );

    await xdx.connect(user0).approve(stakedXdxTracker.address, toWei(1000, 18));
    await stakedXdxTracker.connect(user0).stake(xdx.address, toWei(1000, 18));
    expect(await stakedXdxTracker.stakedAmounts(user0.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.depositBalances(user0.address, xdx.address)).eq(toWei(1000, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await stakedXdxTracker.claimable(user0.address)).gt(toWei(1785, 18)); // 50000 / 28 => ~1785
    expect(await stakedXdxTracker.claimable(user0.address)).lt(toWei(1786, 18));

    await esXdx.mint(user1.address, toWei(500, 18));
    await esXdx.connect(user1).approve(stakedXdxTracker.address, toWei(500, 18));
    await stakedXdxTracker.connect(user1).stake(esXdx.address, toWei(500, 18));
    expect(await stakedXdxTracker.stakedAmounts(user1.address)).eq(toWei(500, 18));
    expect(await stakedXdxTracker.stakedAmounts(user0.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.depositBalances(user0.address, xdx.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.depositBalances(user0.address, esXdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user1.address, xdx.address)).eq(0);
    expect(await stakedXdxTracker.depositBalances(user1.address, esXdx.address)).eq(toWei(500, 18));
    expect(await stakedXdxTracker.totalDepositSupply(xdx.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.totalDepositSupply(esXdx.address)).eq(toWei(500, 18));

    expect(await stakedXdxTracker.averageStakedAmounts(user0.address)).eq(0);
    expect(await stakedXdxTracker.cumulativeRewards(user0.address)).eq(0);
    expect(await stakedXdxTracker.averageStakedAmounts(user1.address)).eq(0);
    expect(await stakedXdxTracker.cumulativeRewards(user1.address)).eq(0);

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await stakedXdxTracker.claimable(user0.address)).gt(toWei(1785 + 1190, 18));
    expect(await stakedXdxTracker.claimable(user0.address)).lt(toWei(1786 + 1191, 18));

    expect(await stakedXdxTracker.claimable(user1.address)).gt(toWei(595, 18));
    expect(await stakedXdxTracker.claimable(user1.address)).lt(toWei(596, 18));

    await expect(stakedXdxTracker.connect(user0).unstake(esXdx.address, toWei(1001, 18))).to.be.revertedWith(
      "RewardTracker: _amount exceeds stakedAmount",
    );

    await expect(stakedXdxTracker.connect(user0).unstake(esXdx.address, toWei(1000, 18))).to.be.revertedWith(
      "RewardTracker: _amount exceeds depositBalance",
    );

    await expect(stakedXdxTracker.connect(user0).unstake(xdx.address, toWei(1001, 18))).to.be.revertedWith(
      "RewardTracker: _amount exceeds stakedAmount",
    );

    expect(await xdx.balanceOf(user0.address)).eq(0);
    await stakedXdxTracker.connect(user0).unstake(xdx.address, toWei(1000, 18));
    expect(await xdx.balanceOf(user0.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.totalDepositSupply(xdx.address)).eq(0);
    expect(await stakedXdxTracker.totalDepositSupply(esXdx.address)).eq(toWei(500, 18));

    expect(await stakedXdxTracker.averageStakedAmounts(user0.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user0.address)).gt(toWei(1785 + 1190, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user0.address)).lt(toWei(1786 + 1191, 18));
    expect(await stakedXdxTracker.averageStakedAmounts(user1.address)).eq(0);
    expect(await stakedXdxTracker.cumulativeRewards(user1.address)).eq(0);

    await expect(stakedXdxTracker.connect(user0).unstake(xdx.address, 1)).to.be.revertedWith(
      "RewardTracker: _amount exceeds stakedAmount",
    );

    expect(await esXdx.balanceOf(user0.address)).eq(0);
    await stakedXdxTracker.connect(user0).claim(user2.address);
    expect(await esXdx.balanceOf(user2.address)).gt(toWei(1785 + 1190, 18));
    expect(await esXdx.balanceOf(user2.address)).lt(toWei(1786 + 1191, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await stakedXdxTracker.claimable(user0.address)).eq(0);

    expect(await stakedXdxTracker.claimable(user1.address)).gt(toWei(595 + 1785, 18));
    expect(await stakedXdxTracker.claimable(user1.address)).lt(toWei(596 + 1786, 18));

    await xdx.mint(user1.address, toWei(300, 18));
    await xdx.connect(user1).approve(stakedXdxTracker.address, toWei(300, 18));
    await stakedXdxTracker.connect(user1).stake(xdx.address, toWei(300, 18));
    expect(await stakedXdxTracker.totalDepositSupply(xdx.address)).eq(toWei(300, 18));
    expect(await stakedXdxTracker.totalDepositSupply(esXdx.address)).eq(toWei(500, 18));

    expect(await stakedXdxTracker.averageStakedAmounts(user0.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user0.address)).gt(toWei(1785 + 1190, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user0.address)).lt(toWei(1786 + 1191, 18));
    expect(await stakedXdxTracker.averageStakedAmounts(user1.address)).eq(toWei(500, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user1.address)).gt(toWei(595 + 1785, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user1.address)).lt(toWei(596 + 1786, 18));

    await expect(stakedXdxTracker.connect(user1).unstake(xdx.address, toWei(301, 18))).to.be.revertedWith(
      "RewardTracker: _amount exceeds depositBalance",
    );

    await expect(stakedXdxTracker.connect(user1).unstake(esXdx.address, toWei(501, 18))).to.be.revertedWith(
      "RewardTracker: _amount exceeds depositBalance",
    );

    await advanceTimeAndBlock(2 * 24 * 60 * 60);

    await stakedXdxTracker.connect(user0).claim(user2.address);
    await stakedXdxTracker.connect(user1).claim(user3.address);

    expect(await stakedXdxTracker.averageStakedAmounts(user0.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user0.address)).gt(toWei(1785 + 1190, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user0.address)).lt(toWei(1786 + 1191, 18));
    expect(await stakedXdxTracker.averageStakedAmounts(user1.address)).gt(toWei(679, 18));
    expect(await stakedXdxTracker.averageStakedAmounts(user1.address)).lt(toWei(681, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user1.address)).gt(toWei(595 + 1785 + 1785 * 2, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user1.address)).lt(toWei(596 + 1786 + 1786 * 2, 18));

    await advanceTimeAndBlock(2 * 24 * 60 * 60);

    await stakedXdxTracker.connect(user0).claim(user2.address);
    await stakedXdxTracker.connect(user1).claim(user3.address);

    expect(await stakedXdxTracker.averageStakedAmounts(user0.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user0.address)).gt(toWei(1785 + 1190, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user0.address)).lt(toWei(1786 + 1191, 18));
    expect(await stakedXdxTracker.averageStakedAmounts(user1.address)).gt(toWei(724, 18));
    expect(await stakedXdxTracker.averageStakedAmounts(user1.address)).lt(toWei(726, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user1.address)).gt(toWei(595 + 1785 + 1785 * 4, 18));
    expect(await stakedXdxTracker.cumulativeRewards(user1.address)).lt(toWei(596 + 1786 + 1786 * 4, 18));

    expect(await esXdx.balanceOf(user2.address)).eq(await stakedXdxTracker.cumulativeRewards(user0.address));
    expect(await esXdx.balanceOf(user3.address)).eq(await stakedXdxTracker.cumulativeRewards(user1.address));

    expect(await xdx.balanceOf(user1.address)).eq(0);
    expect(await esXdx.balanceOf(user1.address)).eq(0);
    await stakedXdxTracker.connect(user1).unstake(xdx.address, toWei(300, 18));
    expect(await xdx.balanceOf(user1.address)).eq(toWei(300, 18));
    expect(await esXdx.balanceOf(user1.address)).eq(0);
    await stakedXdxTracker.connect(user1).unstake(esXdx.address, toWei(500, 18));
    expect(await xdx.balanceOf(user1.address)).eq(toWei(300, 18));
    expect(await esXdx.balanceOf(user1.address)).eq(toWei(500, 18));
    expect(await stakedXdxTracker.totalDepositSupply(xdx.address)).eq(0);
    expect(await stakedXdxTracker.totalDepositSupply(esXdx.address)).eq(0);

    await stakedXdxTracker.connect(user0).claim(user2.address);
    await stakedXdxTracker.connect(user1).claim(user3.address);

    const distributed = toWei(50000, 18).sub(await esXdx.balanceOf(stakedXdxDistributor.address));
    const cumulativeReward0 = await stakedXdxTracker.cumulativeRewards(user0.address);
    const cumulativeReward1 = await stakedXdxTracker.cumulativeRewards(user1.address);
    const totalCumulativeReward = cumulativeReward0.add(cumulativeReward1);

    expect(distributed).gt(totalCumulativeReward.sub(toWei(2, 18)));
    expect(distributed).lt(totalCumulativeReward.add(toWei(2, 18)));
  });

  it("stakeForAccount, unstakeForAccount, claimForAccount", async () => {
    await stakedXdxTracker.setInPrivateTransferMode(false);
    await esXdx.setMinter(deployer.address, true);
    await esXdx.mint(stakedXdxDistributor.address, toWei(50000, 18));
    await stakedXdxDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esXdx per second
    await xdx.setMinter(deployer.address, true);
    await xdx.mint(deployer.address, toWei(1000, 18));

    await stakedXdxTracker.setInPrivateStakingMode(true);
    await expect(stakedXdxTracker.connect(user0).stake(xdx.address, toWei(1000, 18))).to.be.revertedWith(
      "RewardTracker: action not enabled",
    );

    await expect(
      stakedXdxTracker
        .connect(user2)
        .stakeForAccount(deployer.address, user0.address, xdx.address, toWei(1000, 18)),
    ).to.be.revertedWith("RewardTracker: forbidden");

    await stakedXdxTracker.setHandler(user2.address, true);
    await expect(
      stakedXdxTracker
        .connect(user2)
        .stakeForAccount(deployer.address, user0.address, xdx.address, toWei(1000, 18)),
    ).to.be.revertedWith("BaseToken: transfer amount exceeds allowance");

    await xdx.connect(deployer).approve(stakedXdxTracker.address, toWei(1000, 18));

    await stakedXdxTracker
      .connect(user2)
      .stakeForAccount(deployer.address, user0.address, xdx.address, toWei(1000, 18));
    expect(await stakedXdxTracker.stakedAmounts(user0.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.depositBalances(user0.address, xdx.address)).eq(toWei(1000, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await stakedXdxTracker.claimable(user0.address)).gt(toWei(1785, 18)); // 50000 / 28 => ~1785
    expect(await stakedXdxTracker.claimable(user0.address)).lt(toWei(1786, 18));

    await stakedXdxTracker.setHandler(user2.address, false);
    await expect(
      stakedXdxTracker
        .connect(user2)
        .unstakeForAccount(user0.address, esXdx.address, toWei(1000, 18), user1.address),
    ).to.be.revertedWith("RewardTracker: forbidden");

    await stakedXdxTracker.setHandler(user2.address, true);

    await expect(
      stakedXdxTracker
        .connect(user2)
        .unstakeForAccount(user0.address, esXdx.address, toWei(1000, 18), user1.address),
    ).to.be.revertedWith("RewardTracker: _amount exceeds depositBalance");

    await expect(
      stakedXdxTracker
        .connect(user2)
        .unstakeForAccount(user0.address, xdx.address, toWei(1001, 18), user1.address),
    ).to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    expect(await xdx.balanceOf(user0.address)).eq(0);
    expect(await stakedXdxTracker.stakedAmounts(user0.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.depositBalances(user0.address, xdx.address)).eq(toWei(1000, 18));

    expect(await stakedXdxTracker.balanceOf(user0.address)).eq(toWei(1000, 18));
    await stakedXdxTracker.connect(user0).transfer(user1.address, toWei(50, 18));
    expect(await stakedXdxTracker.balanceOf(user0.address)).eq(toWei(950, 18));
    expect(await stakedXdxTracker.balanceOf(user1.address)).eq(toWei(50, 18));

    await stakedXdxTracker.setInPrivateTransferMode(true);
    await expect(stakedXdxTracker.connect(user0).transfer(user1.address, toWei(50, 18))).to.be.revertedWith(
      "RewardTracker: forbidden",
    );

    await stakedXdxTracker.setHandler(user2.address, false);
    await expect(
      stakedXdxTracker.connect(user2).transferFrom(user1.address, user0.address, toWei(50, 18)),
    ).to.be.revertedWith("RewardTracker: transfer amount exceeds allowance");

    await stakedXdxTracker.setHandler(user2.address, true);
    await stakedXdxTracker.connect(user2).transferFrom(user1.address, user0.address, toWei(50, 18));
    expect(await stakedXdxTracker.balanceOf(user0.address)).eq(toWei(1000, 18));
    expect(await stakedXdxTracker.balanceOf(user1.address)).eq(0);

    await stakedXdxTracker
      .connect(user2)
      .unstakeForAccount(user0.address, xdx.address, toWei(100, 18), user1.address);

    expect(await xdx.balanceOf(user1.address)).eq(toWei(100, 18));
    expect(await stakedXdxTracker.stakedAmounts(user0.address)).eq(toWei(900, 18));
    expect(await stakedXdxTracker.depositBalances(user0.address, xdx.address)).eq(toWei(900, 18));

    await expect(
      stakedXdxTracker.connect(user3).claimForAccount(user0.address, user3.address),
    ).to.be.revertedWith("RewardTracker: forbidden");

    expect(await stakedXdxTracker.claimable(user0.address)).gt(toWei(1785, 18));
    expect(await stakedXdxTracker.claimable(user0.address)).lt(toWei(1787, 18));
    expect(await esXdx.balanceOf(user0.address)).eq(0);
    expect(await esXdx.balanceOf(user3.address)).eq(0);

    await stakedXdxTracker.connect(user2).claimForAccount(user0.address, user3.address);

    expect(await stakedXdxTracker.claimable(user0.address)).eq(0);
    expect(await esXdx.balanceOf(user3.address)).gt(toWei(1785, 18));
    expect(await esXdx.balanceOf(user3.address)).lt(toWei(1787, 18));
  });
});
