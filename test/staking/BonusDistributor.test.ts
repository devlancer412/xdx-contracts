import {
  Timelock,
  Timelock__factory,
  ReferralStorage,
  ReferralStorage__factory,
  XDX,
  EsXDX,
  MintableBaseToken,
  RewardTracker,
  RewardDistributor,
  RewardRouter,
  XDX__factory,
  EsXDX__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { advanceTimeAndBlock, Ship, toWei } from "../../utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { utils, constants } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let xdx: XDX;
let esXdx: EsXDX;
let bnXdx: MintableBaseToken;
let stakedXdxTracker: RewardTracker;
let stakedXdxDistributor: RewardDistributor;
let bonusXdxTracker: RewardTracker;
let bonusXdxDistributor: RewardDistributor;

let deployer: SignerWithAddress;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["referralStorage", "timelock"]);

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
describe.only("BonusDistributor", () => {
  beforeEach(async () => {
    const { accounts } = await setup();

    deployer = accounts.deployer;
    alice = accounts.alice;
    bob = accounts.bob;

    xdx = await ship.connect(XDX__factory);
    esXdx = await ship.connect(EsXDX__factory);
    bnXdx = (await ship.connect("BN_XDX")) as MintableBaseToken;
    stakedXdxTracker = (await ship.connect("StakedXdxTracker")) as RewardTracker;
    stakedXdxDistributor = (await ship.connect("StakedXdxDistributor")) as RewardDistributor;
    bonusXdxTracker = (await ship.connect("BonusXdxTracker")) as RewardTracker;
    bonusXdxDistributor = (await ship.connect("BonusXdxDistributor")) as RewardDistributor;

    await stakedXdxTracker.setHandler(alice.address, true);
    await bonusXdxTracker.setHandler(alice.address, true);
  });

  it("distributes bonus", async () => {
    await esXdx.setMinter(deployer.address, true);
    await esXdx.mint(stakedXdxDistributor.address, toWei(50000, 18));
    await bnXdx.setMinter(deployer.address, true);
    await bnXdx.mint(bonusXdxDistributor.address, toWei(1500, 18));
    await stakedXdxDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esXdx per second
    await xdx.setMinter(deployer.address, true);
    await xdx.mint(alice.address, toWei(1000, 18));

    await xdx.connect(alice).approve(stakedXdxTracker.address, toWei(1001, 18));
    await expect(
      stakedXdxTracker
        .connect(alice)
        .stakeForAccount(alice.address, alice.address, xdx.address, toWei(1001, 18)),
    ).to.be.revertedWith("BaseToken: transfer amount exceeds balance");
    await stakedXdxTracker
      .connect(alice)
      .stakeForAccount(alice.address, alice.address, xdx.address, toWei(1000, 18));
    await expect(
      bonusXdxTracker
        .connect(alice)
        .stakeForAccount(alice.address, alice.address, stakedXdxTracker.address, toWei(1001, 18)),
    ).to.be.revertedWith("RewardTracker: transfer amount exceeds balance");
    await bonusXdxTracker
      .connect(alice)
      .stakeForAccount(alice.address, alice.address, stakedXdxTracker.address, toWei(1000, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await stakedXdxTracker.claimable(alice.address)).gt(toWei(1785, 18)); // 50000 / 28 => ~1785
    expect(await stakedXdxTracker.claimable(alice.address)).lt(toWei(1786, 18));
    expect(await bonusXdxTracker.claimable(alice.address)).gt("2730000000000000000"); // 2.73, 1000 / 365 => ~2.74
    expect(await bonusXdxTracker.claimable(alice.address)).lt("2750000000000000000"); // 2.75

    await esXdx.mint(bob.address, toWei(500, 18));
    await esXdx.connect(bob).approve(stakedXdxTracker.address, toWei(500, 18));
    await stakedXdxTracker
      .connect(alice)
      .stakeForAccount(bob.address, bob.address, esXdx.address, toWei(500, 18));
    await bonusXdxTracker
      .connect(alice)
      .stakeForAccount(bob.address, bob.address, stakedXdxTracker.address, toWei(500, 18));

    await advanceTimeAndBlock(24 * 60 * 60);

    expect(await stakedXdxTracker.claimable(alice.address)).gt(toWei(1785 + 1190, 18));
    expect(await stakedXdxTracker.claimable(alice.address)).lt(toWei(1786 + 1191, 18));

    expect(await stakedXdxTracker.claimable(bob.address)).gt(toWei(595, 18));
    expect(await stakedXdxTracker.claimable(bob.address)).lt(toWei(596, 18));

    expect(await bonusXdxTracker.claimable(alice.address)).gt("5470000000000000000"); // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusXdxTracker.claimable(alice.address)).lt("5490000000000000000"); // 5.49

    expect(await bonusXdxTracker.claimable(bob.address)).gt("1360000000000000000"); // 1.36, 500 / 365 => ~1.37
    expect(await bonusXdxTracker.claimable(bob.address)).lt("1380000000000000000"); // 1.38
  });
});
