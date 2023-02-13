import { Timelock, Timelock__factory, ReferralStorage, ReferralStorage__factory } from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship } from "../../utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { utils, constants } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let referralStorage: ReferralStorage;
let timelock: Timelock;

let deployer: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;

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
describe("ReferralStorage", () => {
  beforeEach(async () => {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    user0 = users[0];
    user1 = users[1];
    user2 = users[2];

    referralStorage = await ship.connect(ReferralStorage__factory);
    timelock = await ship.connect(Timelock__factory);

    await timelock.connect(deployer).setBuffer(5 * 24 * 60 * 60);
  });

  it("Sets new handler", async () => {
    await expect(referralStorage.connect(user0).setHandler(user1.address, true)).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await referralStorage.isHandler(user0.address)).to.be.false;
    await expect(referralStorage.connect(user1).setHandler(user0.address, true)).to.be.revertedWith(
      "Governable: forbidden",
    );
    await referralStorage.setHandler(user0.address, true);
    expect(await referralStorage.isHandler(user0.address)).to.be.true;

    await referralStorage.setHandler(user0.address, false);
    expect(await referralStorage.isHandler(user0.address)).to.be.false;
  });

  it("setTier", async () => {
    await expect(referralStorage.connect(user0).setTier(0, 1000, 5000)).to.be.revertedWith(
      "Governable: forbidden",
    );

    let tier0 = await referralStorage.tiers(0);
    expect(tier0.totalRebate).eq(0);
    expect(tier0.discountShare).eq(0);

    await expect(referralStorage.setTier(0, 10001, 5000)).to.be.revertedWith(
      "ReferralStorage: invalid totalRebate",
    );

    await expect(referralStorage.setTier(0, 1000, 10001)).to.be.revertedWith(
      "ReferralStorage: invalid discountShare",
    );

    await referralStorage.setTier(0, 1000, 5000);
    tier0 = await referralStorage.tiers(0);
    expect(tier0.totalRebate).eq(1000);
    expect(tier0.discountShare).eq(5000);

    await referralStorage.setTier(0, 500, 4000);
    tier0 = await referralStorage.tiers(0);
    expect(tier0.totalRebate).eq(500);
    expect(tier0.discountShare).eq(4000);
  });

  it("setReferrerTier", async () => {
    await expect(referralStorage.connect(user0).setReferrerTier(user0.address, 2)).to.be.revertedWith(
      "Governable: forbidden",
    );

    let user0Tier = await referralStorage.referrerTiers(user0.address);
    expect(user0Tier).eq(0);

    await referralStorage.setReferrerTier(user0.address, 2);
    user0Tier = await referralStorage.referrerTiers(user0.address);
    expect(user0Tier).eq(2);
  });

  it("setReferrerDiscountShare", async () => {
    await expect(referralStorage.connect(user0).setReferrerDiscountShare(10001)).to.be.revertedWith(
      "ReferralStorage: invalid discountShare",
    );

    let share = await referralStorage.referrerDiscountShares(user0.address);
    expect(share).eq(0);

    await referralStorage.connect(user0).setReferrerDiscountShare(1234);
    share = await referralStorage.referrerDiscountShares(user0.address);
    expect(share).eq(1234);
  });

  it("setTraderReferralCode", async () => {
    const code = utils.keccak256("0xFF");

    await expect(
      referralStorage.connect(user0).setTraderReferralCode(user1.address, code),
    ).to.be.revertedWith("ReferralStorage: forbidden");

    await referralStorage.setHandler(user0.address, true);

    expect(await referralStorage.traderReferralCodes(user1.address)).eq(constants.HashZero);
    await referralStorage.connect(user0).setTraderReferralCode(user1.address, code);
    expect(await referralStorage.traderReferralCodes(user1.address)).eq(code);

    const code2 = utils.keccak256("0x0F0F");
    await referralStorage.connect(user1).setTraderReferralCodeByUser(code2);
    expect(await referralStorage.traderReferralCodes(user1.address)).eq(code2);
  });

  it("Registers code", async () => {
    await expect(referralStorage.connect(user0).registerCode(constants.HashZero)).to.be.revertedWith(
      "ReferralStorage: invalid _code",
    );

    const code = Buffer.from("MY_BEST_CODE".padStart(32));

    expect(await referralStorage.codeOwners(code)).to.be.equal(constants.AddressZero);

    await referralStorage.connect(user0).registerCode(code);

    expect(await referralStorage.codeOwners(code)).to.be.equal(user0.address);

    await expect(referralStorage.connect(user0).registerCode(code)).to.be.revertedWith(
      "ReferralStorage: code already exists",
    );

    const code2 = utils.keccak256("0xFF11");
    await referralStorage.connect(user0).registerCode(code2);

    expect(await referralStorage.codeOwners(code)).to.be.equal(user0.address);
    expect(await referralStorage.codeOwners(code2)).to.be.equal(user0.address);
  });

  it("setCodeOwner", async () => {
    const code = utils.keccak256("0xFF");

    await referralStorage.connect(user0).registerCode(code);
    expect(await referralStorage.codeOwners(code)).to.be.equal(user0.address);

    await expect(
      referralStorage.connect(user1).setCodeOwner(constants.HashZero, user2.address),
    ).to.be.revertedWith("ReferralStorage: invalid _code");

    await expect(referralStorage.connect(user1).setCodeOwner(code, user2.address)).to.be.revertedWith(
      "ReferralStorage: forbidden",
    );
    await referralStorage.connect(user0).setCodeOwner(code, user2.address);

    expect(await referralStorage.codeOwners(code)).to.be.equal(user2.address);
  });

  it("govSetCodeOwner", async () => {
    const code = utils.keccak256("0xFF");

    await referralStorage.connect(user0).registerCode(code);
    expect(await referralStorage.codeOwners(code)).to.be.equal(user0.address);

    await expect(referralStorage.connect(user1).registerCode(constants.HashZero)).to.be.revertedWith(
      "ReferralStorage: invalid _code",
    );

    await expect(referralStorage.connect(user1).govSetCodeOwner(code, user2.address)).to.be.revertedWith(
      "Governable: forbidden",
    );
    await referralStorage.connect(deployer).govSetCodeOwner(code, user2.address);

    expect(await referralStorage.codeOwners(code)).to.be.equal(user2.address);
  });

  it("getTraderReferralInfo", async () => {
    const code = utils.keccak256("0xFF");

    let info = await referralStorage.getTraderReferralInfo(user1.address);
    expect(info[0]).eq(constants.HashZero);
    expect(info[1]).eq(constants.AddressZero);

    await referralStorage.setHandler(user0.address, true);
    await referralStorage.connect(user0).setTraderReferralCode(user1.address, code);

    info = await referralStorage.getTraderReferralInfo(user1.address);
    expect(info[0]).eq(code);
    expect(info[1]).eq(constants.AddressZero);

    await referralStorage.connect(user1).registerCode(code);

    info = await referralStorage.getTraderReferralInfo(user1.address);
    expect(info[0]).eq(code);
    expect(info[1]).eq(user1.address);
  });

  it("timelock.setTier", async () => {
    await referralStorage.setGov(timelock.address);

    await expect(referralStorage.setTier(1, 12, 20)).to.be.revertedWith("Governable: forbidden");

    await expect(timelock.connect(user0).setTier(referralStorage.address, 1, 12, 20)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await timelock.setContractHandler(user0.address, true);

    let tier = await referralStorage.tiers(1);
    expect(tier.totalRebate).eq(0);
    expect(tier.discountShare).eq(0);

    await timelock.connect(user0).setTier(referralStorage.address, 1, 12, 20);

    tier = await referralStorage.tiers(1);
    expect(tier.totalRebate).eq(12);
    expect(tier.discountShare).eq(20);
  });

  it("timelock.setReferrerTier", async () => {
    await referralStorage.setGov(timelock.address);

    await expect(referralStorage.setReferrerTier(user1.address, 2)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await expect(
      timelock.connect(user0).setReferrerTier(referralStorage.address, user1.address, 2),
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.setContractHandler(user0.address, true);

    expect(await referralStorage.referrerTiers(user1.address)).eq(0);
    await timelock.connect(user0).setReferrerTier(referralStorage.address, user1.address, 2);
    expect(await referralStorage.referrerTiers(user1.address)).eq(2);
  });

  it("timelock.govSetCodeOwner", async () => {
    const code = utils.keccak256("0xFF");
    await referralStorage.setGov(timelock.address);

    await expect(referralStorage.govSetCodeOwner(code, user1.address)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await expect(
      timelock.connect(user0).govSetCodeOwner(referralStorage.address, code, user1.address),
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.setContractHandler(user0.address, true);

    expect(await referralStorage.codeOwners(code)).eq(constants.AddressZero);
    await timelock.connect(user0).govSetCodeOwner(referralStorage.address, code, user1.address);
    expect(await referralStorage.codeOwners(code)).eq(user1.address);
  });
});
