import {
  Token,
  ShortsTracker,
  ShortsTrackerTimelock,
  ShortsTracker__factory,
  ShortsTrackerTimelock__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { advanceTime, Ship, toUsd, toWei } from "../../utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { constants } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let shortsTracker: ShortsTracker;
let shortsTrackerTimelock: ShortsTrackerTimelock;

let eth: Token;
let btc: Token;

let deployer: SignerWithAddress;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["shortsTracker", "shortsTrackerTimelock"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("ShortsTrackerTimelock", () => {
  beforeEach(async () => {
    const { accounts } = await setup();

    deployer = accounts.deployer;
    alice = accounts.alice;
    bob = accounts.bob;

    eth = (await ship.connect("eth")) as Token;
    btc = (await ship.connect("btc")) as Token;

    shortsTracker = await ship.connect(ShortsTracker__factory);
    shortsTrackerTimelock = await ship.connect(ShortsTrackerTimelock__factory);

    await shortsTracker.setGov(shortsTrackerTimelock.address);
  });

  it("inits", async function () {
    expect(await shortsTrackerTimelock.admin()).to.eq(deployer.address);
    expect(await shortsTrackerTimelock.buffer()).to.eq(60);
    expect(await shortsTrackerTimelock.averagePriceUpdateDelay()).to.eq(300);
  });

  it("setBuffer", async () => {
    expect(await shortsTrackerTimelock.buffer()).to.eq(60);
    await expect(shortsTrackerTimelock.connect(alice).setBuffer(50)).to.be.revertedWith(
      "ShortsTrackerTimelock: admin forbidden",
    );
    await expect(shortsTrackerTimelock.setBuffer(50)).to.be.revertedWith(
      "ShortsTrackerTimelock: buffer cannot be decreased",
    );
    await expect(shortsTrackerTimelock.setBuffer(86400 * 5 + 1)).to.be.revertedWith(
      "ShortsTrackerTimelock: invalid buffer",
    );

    await shortsTrackerTimelock.setBuffer(120);
    expect(await shortsTrackerTimelock.buffer()).to.eq(120);
  });

  it("setAdmin", async () => {
    await expect(shortsTrackerTimelock.connect(alice).signalSetAdmin(alice.address)).to.be.revertedWith(
      "ShortsTrackerTimelock: admin forbidden",
    );
    await expect(shortsTrackerTimelock.connect(alice).setAdmin(alice.address)).to.be.revertedWith(
      "ShortsTrackerTimelock: admin forbidden",
    );

    await expect(shortsTrackerTimelock.setAdmin(alice.address)).to.be.revertedWith(
      "ShortsTrackerTimelock: action not signalled",
    );

    await expect(shortsTrackerTimelock.signalSetAdmin(constants.AddressZero)).to.be.revertedWith(
      "ShortsTrackerTimelock: invalid admin",
    );
    await shortsTrackerTimelock.signalSetAdmin(alice.address);
    await expect(shortsTrackerTimelock.setAdmin(alice.address)).to.be.revertedWith(
      "ShortsTrackerTimelock: action time not yet passed",
    );

    await advanceTime(58);
    await expect(shortsTrackerTimelock.setAdmin(alice.address)).to.be.revertedWith(
      "ShortsTrackerTimelock: action time not yet passed",
    );

    await advanceTime(1);
    expect(await shortsTrackerTimelock.admin()).to.eq(deployer.address);
    await shortsTrackerTimelock.setAdmin(alice.address);
    expect(await shortsTrackerTimelock.admin()).to.eq(alice.address);
  });

  it("setHandler", async () => {
    await expect(shortsTrackerTimelock.connect(alice).setHandler(alice.address, true)).to.be.revertedWith(
      "ShortsTrackerTimelock: admin forbidden",
    );

    expect(await shortsTrackerTimelock.isHandler(alice.address)).to.be.false;
    await shortsTrackerTimelock.setHandler(alice.address, true);
    expect(await shortsTrackerTimelock.isHandler(alice.address)).to.be.true;

    await shortsTrackerTimelock.setHandler(alice.address, false);
    expect(await shortsTrackerTimelock.isHandler(alice.address)).to.be.false;
  });

  it("setGov", async () => {
    await expect(
      shortsTrackerTimelock.connect(alice).signalSetGov(shortsTracker.address, alice.address),
    ).to.be.revertedWith("ShortsTrackerTimelock: admin forbidden");
    await expect(
      shortsTrackerTimelock.connect(alice).setGov(shortsTracker.address, alice.address),
    ).to.be.revertedWith("ShortsTrackerTimelock: admin forbidden");

    await expect(shortsTrackerTimelock.setGov(shortsTracker.address, alice.address)).to.be.revertedWith(
      "ShortsTrackerTimelock: action not signalled",
    );

    await expect(
      shortsTrackerTimelock.signalSetGov(shortsTracker.address, constants.AddressZero),
    ).to.be.revertedWith("ShortsTrackerTimelock: invalid gov");
    await shortsTrackerTimelock.signalSetGov(shortsTracker.address, alice.address);
    await expect(shortsTrackerTimelock.setGov(shortsTracker.address, alice.address)).to.be.revertedWith(
      "ShortsTrackerTimelock: action time not yet passed",
    );

    await advanceTime(58);
    await expect(shortsTrackerTimelock.setGov(shortsTracker.address, alice.address)).to.be.revertedWith(
      "ShortsTrackerTimelock: action time not yet passed",
    );

    await advanceTime(1);
    expect(await shortsTracker.gov()).to.eq(shortsTrackerTimelock.address);
    await shortsTrackerTimelock.setGov(shortsTracker.address, alice.address);
    expect(await shortsTracker.gov()).to.eq(alice.address);
  });

  it("setAveragePriceUpdateDelay", async () => {
    await expect(
      shortsTrackerTimelock.connect(alice).signalSetAveragePriceUpdateDelay(60),
    ).to.be.revertedWith("ShortsTrackerTimelock: admin forbidden");
    await expect(shortsTrackerTimelock.connect(alice).setAveragePriceUpdateDelay(60)).to.be.revertedWith(
      "ShortsTrackerTimelock: admin forbidden",
    );

    await expect(shortsTrackerTimelock.setAveragePriceUpdateDelay(60)).to.be.revertedWith(
      "ShortsTrackerTimelock: action not signalled",
    );

    await shortsTrackerTimelock.signalSetAveragePriceUpdateDelay(60);
    await expect(shortsTrackerTimelock.setAveragePriceUpdateDelay(60)).to.be.revertedWith(
      "ShortsTrackerTimelock: action time not yet passed",
    );

    await advanceTime(58);
    await expect(shortsTrackerTimelock.setAveragePriceUpdateDelay(60)).to.be.revertedWith(
      "ShortsTrackerTimelock: action time not yet passed",
    );

    await advanceTime(1);
    expect(await shortsTrackerTimelock.averagePriceUpdateDelay()).to.eq(300);
    await shortsTrackerTimelock.setAveragePriceUpdateDelay(60);
    expect(await shortsTrackerTimelock.averagePriceUpdateDelay()).to.eq(60);
  });

  it("setMaxAveragePriceChange", async () => {
    await expect(shortsTrackerTimelock.connect(alice).signalSetMaxAveragePriceChange(10)).to.be.revertedWith(
      "ShortsTrackerTimelock: admin forbidden",
    );
    await expect(shortsTrackerTimelock.connect(alice).setMaxAveragePriceChange(10)).to.be.revertedWith(
      "ShortsTrackerTimelock: admin forbidden",
    );

    await expect(shortsTrackerTimelock.setMaxAveragePriceChange(10)).to.be.revertedWith(
      "ShortsTrackerTimelock: action not signalled",
    );

    await shortsTrackerTimelock.signalSetMaxAveragePriceChange(10);
    await expect(shortsTrackerTimelock.setMaxAveragePriceChange(10)).to.be.revertedWith(
      "ShortsTrackerTimelock: action time not yet passed",
    );

    await advanceTime(58);
    await expect(shortsTrackerTimelock.setMaxAveragePriceChange(10)).to.be.revertedWith(
      "ShortsTrackerTimelock: action time not yet passed",
    );

    await advanceTime(1);
    expect(await shortsTrackerTimelock.maxAveragePriceChange()).to.eq(20);
    await shortsTrackerTimelock.setMaxAveragePriceChange(10);
    expect(await shortsTrackerTimelock.maxAveragePriceChange()).to.eq(10);
  });

  it("setIsGlobalShortDataReady", async () => {
    await expect(
      shortsTrackerTimelock.connect(alice).signalSetIsGlobalShortDataReady(shortsTracker.address, true),
    ).to.be.revertedWith("ShortsTrackerTimelock: admin forbidden");
    await expect(
      shortsTrackerTimelock.connect(alice).setIsGlobalShortDataReady(shortsTracker.address, true),
    ).to.be.revertedWith("ShortsTrackerTimelock: admin forbidden");

    await expect(
      shortsTrackerTimelock.setIsGlobalShortDataReady(shortsTracker.address, true),
    ).to.be.revertedWith("ShortsTrackerTimelock: action not signalled");

    await shortsTrackerTimelock.signalSetIsGlobalShortDataReady(shortsTracker.address, true);
    await expect(
      shortsTrackerTimelock.setIsGlobalShortDataReady(shortsTracker.address, true),
    ).to.be.revertedWith("ShortsTrackerTimelock: action time not yet passed");

    await advanceTime(58);
    await expect(
      shortsTrackerTimelock.setIsGlobalShortDataReady(shortsTracker.address, true),
    ).to.be.revertedWith("ShortsTrackerTimelock: action time not yet passed");

    await advanceTime(1);
    expect(await shortsTracker.isGlobalShortDataReady()).to.be.false;
    await shortsTrackerTimelock.setIsGlobalShortDataReady(shortsTracker.address, true);
    expect(await shortsTracker.isGlobalShortDataReady()).to.be.true;
  });

  it("disableIsGlobalShortDataReady", async () => {
    await shortsTrackerTimelock.signalSetGov(shortsTracker.address, alice.address);
    await advanceTime(61);
    await shortsTrackerTimelock.setGov(shortsTracker.address, alice.address);
    expect(await shortsTracker.gov()).to.eq(alice.address);

    await shortsTracker.connect(alice).setInitData([eth.address, btc.address], [toUsd(1600), toUsd(20500)]);
    await shortsTracker.connect(alice).setGov(shortsTrackerTimelock.address);

    expect(await shortsTracker.isGlobalShortDataReady()).to.be.true;
    await shortsTrackerTimelock.disableIsGlobalShortDataReady(shortsTracker.address);
    expect(await shortsTracker.isGlobalShortDataReady()).to.be.false;
  });

  it("setGlobalShortAveragePrices", async () => {
    await shortsTrackerTimelock.signalSetGov(shortsTracker.address, alice.address);
    await advanceTime(61);
    await shortsTrackerTimelock.setGov(shortsTracker.address, alice.address);
    expect(await shortsTracker.gov()).to.eq(alice.address);

    await shortsTracker.connect(alice).setInitData([eth.address, btc.address], [toUsd(1600), toUsd(20500)]);
    expect(await shortsTracker.globalShortAveragePrices(eth.address)).to.eq(toUsd(1600));

    await shortsTracker.connect(alice).setGov(shortsTrackerTimelock.address);
    expect(await shortsTracker.gov()).to.eq(shortsTrackerTimelock.address);

    await shortsTrackerTimelock.signalSetMaxAveragePriceChange(10);
    await advanceTime(61);
    await shortsTrackerTimelock.setMaxAveragePriceChange(10);
    expect(await shortsTrackerTimelock.maxAveragePriceChange()).to.eq(10);

    await expect(
      shortsTrackerTimelock
        .connect(bob)
        .setGlobalShortAveragePrices(shortsTracker.address, [eth.address], [toUsd(1602)]),
    ).to.be.revertedWith("ShortsTrackerTimelock: handler forbidden");

    await shortsTrackerTimelock.setHandler(bob.address, true);
    await expect(
      shortsTrackerTimelock
        .connect(bob)
        .setGlobalShortAveragePrices(shortsTracker.address, [eth.address], [toUsd(1602)]),
    ).to.be.revertedWith("ShortsTrackerTimelock: too big change");

    await shortsTrackerTimelock
      .connect(bob)
      .setGlobalShortAveragePrices(shortsTracker.address, [eth.address], [toUsd(1601)]);
    expect(await shortsTracker.globalShortAveragePrices(eth.address)).to.eq(toUsd(1601));

    await expect(
      shortsTrackerTimelock
        .connect(bob)
        .setGlobalShortAveragePrices(shortsTracker.address, [eth.address], [toUsd(1601)]),
    ).to.be.revertedWith("ShortsTrackerTimelock: too early");

    expect(await shortsTrackerTimelock.averagePriceUpdateDelay()).to.eq(300);
    await advanceTime(290);
    await expect(
      shortsTrackerTimelock
        .connect(bob)
        .setGlobalShortAveragePrices(shortsTracker.address, [eth.address], [toUsd(1601)]),
    ).to.be.revertedWith("ShortsTrackerTimelock: too early");

    await advanceTime(10);
    await shortsTrackerTimelock
      .connect(bob)
      .setGlobalShortAveragePrices(shortsTracker.address, [eth.address], [toUsd(1602)]);
    expect(await shortsTracker.globalShortAveragePrices(eth.address)).to.eq(toUsd(1602));
  });
});
