import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VaultPriceFeed__factory,
  Token,
  Vault__factory,
  PriceFeed,
  VaultPriceFeed,
  FastPriceEvents,
  FastPriceFeed,
  FastPriceEvents__factory,
  Timelock,
  Timelock__factory,
  Vault,
  PositionRouter,
  PositionRouter__factory,
  Token__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import {
  advanceBlock,
  advanceTimeAndBlock,
  getPriceBitArray,
  getPriceBits,
  getTime,
  reportGasUsed,
  Ship,
  toWei,
} from "../../utils";
import { FastPriceFeed__factory } from "./../../types/factories/oracle/FastPriceFeed__factory";
import { constants, BigNumberish, BigNumber, utils } from "ethers";

function getExpandedPrice(price: BigNumberish, precision: BigNumberish) {
  return BigNumber.from(price).mul(toWei(1, 30)).div(precision);
}

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let avax: Token;
let avaxPriceFeed: PriceFeed;
let btc: Token;
let eth: Token;

let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let fastPriceEvents: FastPriceEvents;
let fastPriceFeed: FastPriceFeed;
let timelock: Timelock;
let positionRouter: PositionRouter;

let deployer: SignerWithAddress;
let alice: SignerWithAddress;
let bob: SignerWithAddress;
let signer0: SignerWithAddress;
let signer1: SignerWithAddress;
let updater0: SignerWithAddress;
let updater1: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["tokens", "vaultPriceFeed", "fastPriceEvents", "fastPriceFeed", "timelock"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("FastPriceFeed", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    alice = accounts.alice;
    bob = accounts.bob;
    signer0 = accounts.signer1;
    signer1 = accounts.signer2;
    updater0 = accounts.updater1;
    updater1 = accounts.updater2;

    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;
    btc = (await ship.connect("btc")) as Token;
    eth = (await ship.connect("eth")) as Token;

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    fastPriceEvents = await ship.connect(FastPriceEvents__factory);
    fastPriceFeed = await ship.connect(FastPriceFeed__factory);
    timelock = await ship.connect(Timelock__factory);
    positionRouter = await ship.connect(PositionRouter__factory);

    await timelock.setBuffer(5 * 24 * 60 * 60);
    await timelock.setMarginFeeBasisPoints(10, 500);
    await fastPriceFeed.setPriceDuration(5 * 60);
    await fastPriceFeed.setMaxPriceUpdateDelay(120 * 60);
    await fastPriceFeed.setMinBlockInterval(2);
    await fastPriceFeed.setMaxDeviationBasisPoints(250);

    await vault.setGov(timelock.address);
    await fastPriceFeed.setVaultPriceFeed(constants.AddressZero);
  });

  it("inits", async () => {
    expect(await fastPriceFeed.gov()).eq(deployer.address);
    expect(await fastPriceFeed.priceDuration()).eq(5 * 60);
    expect(await fastPriceFeed.maxPriceUpdateDelay()).eq(120 * 60);
    expect(await fastPriceFeed.minBlockInterval()).eq(2);
    expect(await fastPriceFeed.maxDeviationBasisPoints()).eq(250);
    expect(await fastPriceFeed.fastPriceEvents()).eq(fastPriceEvents.address);
    expect(await fastPriceFeed.tokenManager()).eq(deployer.address);
    expect(await fastPriceFeed.positionRouter()).eq(positionRouter.address);
    expect(await fastPriceFeed.minAuthorizations()).eq(2);
    expect(await fastPriceFeed.isSigner(deployer.address)).eq(false);
    expect(await fastPriceFeed.isSigner(signer0.address)).eq(true);
    expect(await fastPriceFeed.isSigner(signer1.address)).eq(true);

    expect(await fastPriceFeed.isUpdater(deployer.address)).eq(false);
    expect(await fastPriceFeed.isUpdater(updater0.address)).eq(true);
    expect(await fastPriceFeed.isUpdater(updater1.address)).eq(true);

    await expect(
      fastPriceFeed.initialize(2, [signer0.address, signer1.address], [updater0.address, updater1.address]),
    ).to.be.revertedWith("FastPriceFeed: already initialized");
  });

  it("setSigner", async () => {
    await expect(fastPriceFeed.connect(alice).setSigner(bob.address, true)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    expect(await fastPriceFeed.isSigner(bob.address)).eq(false);
    await fastPriceFeed.connect(alice).setSigner(bob.address, true);
    expect(await fastPriceFeed.isSigner(bob.address)).eq(true);
  });

  it("setUpdater", async () => {
    await expect(fastPriceFeed.connect(alice).setUpdater(bob.address, true)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    expect(await fastPriceFeed.isUpdater(bob.address)).eq(false);
    await fastPriceFeed.connect(alice).setUpdater(bob.address, true);
    expect(await fastPriceFeed.isUpdater(bob.address)).eq(true);
  });

  it("setFastPriceEvents", async () => {
    await expect(fastPriceFeed.connect(alice).setFastPriceEvents(bob.address)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    expect(await fastPriceFeed.fastPriceEvents()).eq(fastPriceEvents.address);
    await fastPriceFeed.connect(alice).setFastPriceEvents(bob.address);
    expect(await fastPriceFeed.fastPriceEvents()).eq(bob.address);
  });

  it("setVaultPriceFeed", async () => {
    await expect(fastPriceFeed.connect(alice).setVaultPriceFeed(vaultPriceFeed.address)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    expect(await fastPriceFeed.vaultPriceFeed()).eq(constants.AddressZero);
    await fastPriceFeed.connect(alice).setVaultPriceFeed(vaultPriceFeed.address);
    expect(await fastPriceFeed.vaultPriceFeed()).eq(vaultPriceFeed.address);
  });

  it("setMaxTimeDeviation", async () => {
    await expect(fastPriceFeed.connect(alice).setMaxTimeDeviation(1000)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    expect(await fastPriceFeed.maxTimeDeviation()).eq(3600);
    await fastPriceFeed.connect(alice).setMaxTimeDeviation(1000);
    expect(await fastPriceFeed.maxTimeDeviation()).eq(1000);
  });

  it("setPriceDuration", async () => {
    await expect(fastPriceFeed.connect(alice).setPriceDuration(30 * 60)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    await expect(fastPriceFeed.connect(alice).setPriceDuration(31 * 60)).to.be.revertedWith(
      "FastPriceFeed: invalid _priceDuration",
    );

    expect(await fastPriceFeed.priceDuration()).eq(5 * 60);
    await fastPriceFeed.connect(alice).setPriceDuration(30 * 60);
    expect(await fastPriceFeed.priceDuration()).eq(30 * 60);
  });

  it("setMaxPriceUpdateDelay", async () => {
    await expect(fastPriceFeed.connect(alice).setMaxPriceUpdateDelay(50 * 60)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    expect(await fastPriceFeed.maxPriceUpdateDelay()).eq(2 * 60 * 60);
    await fastPriceFeed.connect(alice).setMaxPriceUpdateDelay(50 * 60);
    expect(await fastPriceFeed.maxPriceUpdateDelay()).eq(50 * 60);
  });

  it("setSpreadBasisPointsIfInactive", async () => {
    await expect(fastPriceFeed.connect(alice).setSpreadBasisPointsIfInactive(30)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    expect(await fastPriceFeed.spreadBasisPointsIfInactive()).eq(50);
    await fastPriceFeed.connect(alice).setSpreadBasisPointsIfInactive(30);
    expect(await fastPriceFeed.spreadBasisPointsIfInactive()).eq(30);
  });

  it("setSpreadBasisPointsIfChainError", async () => {
    await expect(fastPriceFeed.connect(alice).setSpreadBasisPointsIfChainError(500)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    expect(await fastPriceFeed.spreadBasisPointsIfChainError()).eq(500);
    await fastPriceFeed.connect(alice).setSpreadBasisPointsIfChainError(500);
    expect(await fastPriceFeed.spreadBasisPointsIfChainError()).eq(500);
  });

  it("setMinBlockInterval", async () => {
    await expect(fastPriceFeed.connect(alice).setMinBlockInterval(10)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    expect(await fastPriceFeed.minBlockInterval()).eq(2);
    await fastPriceFeed.connect(alice).setMinBlockInterval(10);
    expect(await fastPriceFeed.minBlockInterval()).eq(10);
  });

  it("setIsSpreadEnabled", async () => {
    await expect(fastPriceFeed.connect(alice).setIsSpreadEnabled(true)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    expect(await fastPriceFeed.isSpreadEnabled()).eq(false);
    expect(await fastPriceFeed.favorFastPrice(constants.AddressZero)).eq(true);
    await fastPriceFeed.connect(alice).setIsSpreadEnabled(true);
    expect(await fastPriceFeed.isSpreadEnabled()).eq(true);
    expect(await fastPriceFeed.favorFastPrice(constants.AddressZero)).eq(false);
  });

  it("setTokenManager", async () => {
    await expect(fastPriceFeed.connect(alice).setTokenManager(bob.address)).to.be.revertedWith(
      "FastPriceFeed: forbidden",
    );

    expect(await fastPriceFeed.tokenManager()).eq(deployer.address);
    await fastPriceFeed.connect(deployer).setTokenManager(bob.address);
    expect(await fastPriceFeed.tokenManager()).eq(bob.address);
  });

  it("setMaxDeviationBasisPoints", async () => {
    await expect(fastPriceFeed.connect(alice).setMaxDeviationBasisPoints(100)).to.be.revertedWith(
      "FastPriceFeed: forbidden",
    );

    expect(await fastPriceFeed.maxDeviationBasisPoints()).eq(250);
    await fastPriceFeed.connect(deployer).setMaxDeviationBasisPoints(100);
    expect(await fastPriceFeed.maxDeviationBasisPoints()).eq(100);
  });

  it("setMaxCumulativeDeltaDiffs", async () => {
    await expect(
      fastPriceFeed.connect(alice).setMaxCumulativeDeltaDiffs([btc.address, eth.address], [300, 500]),
    ).to.be.revertedWith("FastPriceFeed: forbidden");

    expect(await fastPriceFeed.maxCumulativeDeltaDiffs(btc.address)).eq(1000000);
    expect(await fastPriceFeed.maxCumulativeDeltaDiffs(eth.address)).eq(1000000);

    await fastPriceFeed.connect(deployer).setMaxCumulativeDeltaDiffs([btc.address, eth.address], [300, 500]);

    expect(await fastPriceFeed.maxCumulativeDeltaDiffs(btc.address)).eq(300);
    expect(await fastPriceFeed.maxCumulativeDeltaDiffs(eth.address)).eq(500);
  });

  it("setPriceDataInterval", async () => {
    await expect(fastPriceFeed.connect(alice).setPriceDataInterval(300)).to.be.revertedWith(
      "FastPriceFeed: forbidden",
    );

    expect(await fastPriceFeed.priceDataInterval()).eq(60);
    await fastPriceFeed.connect(deployer).setPriceDataInterval(300);
    expect(await fastPriceFeed.priceDataInterval()).eq(300);
  });

  it("setMinAuthorizations", async () => {
    await expect(fastPriceFeed.connect(alice).setMinAuthorizations(3)).to.be.revertedWith(
      "FastPriceFeed: forbidden",
    );

    expect(await fastPriceFeed.minAuthorizations()).eq(2);
    await fastPriceFeed.connect(deployer).setMinAuthorizations(3);
    expect(await fastPriceFeed.minAuthorizations()).eq(3);
  });

  it("setLastUpdatedAt", async () => {
    await expect(fastPriceFeed.connect(alice).setLastUpdatedAt(700)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await fastPriceFeed.setGov(alice.address);

    expect(await fastPriceFeed.lastUpdatedAt()).eq(0);
    await fastPriceFeed.connect(alice).setLastUpdatedAt(700);
    expect(await fastPriceFeed.lastUpdatedAt()).eq(700);
  });

  it("setPrices", async () => {
    const blockTime = await getTime();
    await expect(
      fastPriceFeed
        .connect(alice)
        .setPrices(
          [btc.address, eth.address, avax.address],
          [toWei(60000, 30), toWei(5000, 30), toWei(700, 30)],
          blockTime + 100,
        ),
    ).to.be.revertedWith("FastPriceFeed: forbidden");

    expect(await fastPriceFeed.lastUpdatedAt()).eq(0);
    expect(await fastPriceFeed.lastUpdatedBlock()).eq(0);

    await fastPriceFeed.setMaxTimeDeviation(0);

    await expect(
      fastPriceFeed
        .connect(updater0)
        .setPrices(
          [btc.address, eth.address, avax.address],
          [toWei(60000, 30), toWei(5000, 30), toWei(700, 30)],
          blockTime + 100,
        ),
    ).to.be.revertedWith("FastPriceFeed: _timestamp exceeds allowed range");

    await fastPriceFeed.setMaxTimeDeviation(200);

    await fastPriceFeed
      .connect(updater0)
      .setPrices(
        [btc.address, eth.address, avax.address],
        [toWei(60000, 30), toWei(5000, 30), toWei(700, 30)],
        blockTime + 100,
      );
    const blockNumber0 = await ship.provider.getBlockNumber();
    expect(await fastPriceFeed.lastUpdatedBlock()).eq(blockNumber0);

    expect(await fastPriceFeed.prices(btc.address)).eq(toWei(60000, 30));
    expect(await fastPriceFeed.prices(eth.address)).eq(toWei(5000, 30));
    expect(await fastPriceFeed.prices(avax.address)).eq(toWei(700, 30));

    expect(await fastPriceFeed.lastUpdatedAt()).eq(blockTime + 100);

    await expect(
      fastPriceFeed
        .connect(updater0)
        .setPrices(
          [btc.address, eth.address, avax.address],
          [toWei(60000, 30), toWei(5000, 30), toWei(700, 30)],
          blockTime + 100,
        ),
    ).to.be.revertedWith("FastPriceFeed: minBlockInterval not yet passed");
    const blockNumber1 = await ship.provider.getBlockNumber();
    expect(blockNumber1 - blockNumber0).eq(1);
    await advanceBlock();

    await fastPriceFeed
      .connect(updater1)
      .setPrices(
        [btc.address, eth.address, avax.address],
        [toWei(60000, 30), toWei(5000, 30), toWei(700, 30)],
        blockTime + 100,
      );
    expect(await fastPriceFeed.lastUpdatedBlock()).eq(blockNumber0 + 3);
  });

  it("favorFastPrice", async () => {
    await expect(fastPriceFeed.connect(alice).disableFastPrice()).to.be.revertedWith(
      "FastPriceFeed: forbidden",
    );
    await expect(fastPriceFeed.connect(bob).disableFastPrice()).to.be.revertedWith(
      "FastPriceFeed: forbidden",
    );

    expect(await fastPriceFeed.favorFastPrice(constants.AddressZero)).eq(true);
    expect(await fastPriceFeed.disableFastPriceVotes(signer0.address)).eq(false);
    expect(await fastPriceFeed.disableFastPriceVoteCount()).eq(0);

    await fastPriceFeed.connect(signer0).disableFastPrice();

    expect(await fastPriceFeed.favorFastPrice(constants.AddressZero)).eq(true);
    expect(await fastPriceFeed.disableFastPriceVotes(signer0.address)).eq(true);
    expect(await fastPriceFeed.disableFastPriceVoteCount()).eq(1);

    await expect(fastPriceFeed.connect(signer0).disableFastPrice()).to.be.revertedWith(
      "FastPriceFeed: already voted",
    );

    expect(await fastPriceFeed.favorFastPrice(constants.AddressZero)).eq(true);
    expect(await fastPriceFeed.disableFastPriceVotes(signer1.address)).eq(false);
    expect(await fastPriceFeed.disableFastPriceVoteCount()).eq(1);

    await fastPriceFeed.connect(signer1).disableFastPrice();

    expect(await fastPriceFeed.favorFastPrice(constants.AddressZero)).eq(false);
    expect(await fastPriceFeed.disableFastPriceVotes(signer1.address)).eq(true);
    expect(await fastPriceFeed.disableFastPriceVoteCount()).eq(2);

    await expect(fastPriceFeed.connect(bob).enableFastPrice()).to.be.revertedWith("FastPriceFeed: forbidden");

    await fastPriceFeed.connect(signer1).enableFastPrice();

    expect(await fastPriceFeed.favorFastPrice(constants.AddressZero)).eq(true);
    expect(await fastPriceFeed.disableFastPriceVotes(signer1.address)).eq(false);
    expect(await fastPriceFeed.disableFastPriceVoteCount()).eq(1);

    await expect(fastPriceFeed.connect(signer1).enableFastPrice()).to.be.revertedWith(
      "FastPriceFeed: already enabled",
    );
  });

  it("getPrice", async () => {
    let blockTime = await getTime();
    await fastPriceFeed.setMaxTimeDeviation(1000);

    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(840);
    await fastPriceFeed.connect(updater0).setPrices([avax.address], [801], blockTime);
    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(801);

    await advanceBlock();
    await fastPriceFeed.connect(updater0).setPrices([avax.address], [900], blockTime);
    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(900);
    expect(await fastPriceFeed.getPrice(avax.address, 800, false)).eq(800);

    await advanceBlock();
    await fastPriceFeed.connect(updater0).setPrices([avax.address], [700], blockTime);
    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(800);
    expect(await fastPriceFeed.getPrice(avax.address, 800, false)).eq(700);

    await advanceBlock();
    await fastPriceFeed.connect(updater1).setPrices([avax.address], [900], blockTime);

    await advanceTimeAndBlock(200);

    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(900);

    await advanceTimeAndBlock(110);

    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(804);

    await advanceBlock();
    await fastPriceFeed.connect(updater1).setPrices([avax.address], [810], blockTime);

    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(804);

    blockTime = blockTime + 500;

    await advanceBlock();
    await fastPriceFeed.connect(updater1).setPrices([avax.address], [810], blockTime);

    await fastPriceFeed.setSpreadBasisPointsIfInactive(0);
    await fastPriceFeed.setSpreadBasisPointsIfChainError(0);

    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(810);
    expect(await fastPriceFeed.getPrice(avax.address, 800, false)).eq(810);

    await advanceBlock();
    await fastPriceFeed.connect(updater1).setPrices([avax.address], [790], blockTime);
    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(790);
    expect(await fastPriceFeed.getPrice(avax.address, 800, false)).eq(790);

    await advanceTimeAndBlock(500 + 310);

    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(800);
    expect(await fastPriceFeed.getPrice(avax.address, 800, false)).eq(800);

    expect(await fastPriceFeed.spreadBasisPointsIfInactive()).eq(0);
    await fastPriceFeed.setSpreadBasisPointsIfInactive(50);

    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(804);
    expect(await fastPriceFeed.getPrice(avax.address, 800, false)).eq(796);

    await advanceTimeAndBlock(120 * 60);

    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(800);
    expect(await fastPriceFeed.getPrice(avax.address, 800, false)).eq(800);

    expect(await fastPriceFeed.spreadBasisPointsIfChainError()).eq(0);
    await fastPriceFeed.setSpreadBasisPointsIfChainError(500);

    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(840);
    expect(await fastPriceFeed.getPrice(avax.address, 800, false)).eq(760);

    blockTime = await getTime();
    await fastPriceFeed.connect(updater1).setPrices([avax.address], [790], blockTime);

    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(790);
    expect(await fastPriceFeed.getPrice(avax.address, 800, false)).eq(790);

    await fastPriceFeed.setIsSpreadEnabled(true);

    expect(await fastPriceFeed.getPrice(avax.address, 800, true)).eq(800);
    expect(await fastPriceFeed.getPrice(avax.address, 800, false)).eq(790);
  });

  it("setTokens", async () => {
    const token1 = (
      await ship.deploy(Token__factory, { aliasName: "Token1", args: ["Token1", "Token1", 18] })
    ).contract;
    const token2 = (
      await ship.deploy(Token__factory, { aliasName: "Token2", args: ["Token2", "Token2", 18] })
    ).contract;

    await expect(
      fastPriceFeed.connect(alice).setTokens([token1.address, token2.address], [100, 1000]),
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(alice.address);

    await expect(
      fastPriceFeed.connect(alice).setTokens([token1.address, token2.address], [100]),
    ).to.be.revertedWith("FastPriceFeed: invalid lengths");

    await fastPriceFeed.connect(alice).setTokens([token1.address, token2.address], [100, 1000]);

    expect(await fastPriceFeed.tokens(0)).eq(token1.address);
    expect(await fastPriceFeed.tokens(1)).eq(token2.address);
    expect(await fastPriceFeed.tokenPrecisions(0)).eq(100);
    expect(await fastPriceFeed.tokenPrecisions(1)).eq(1000);
  });

  it("setCompactedPrices", async () => {
    const price1 = "2009991111";
    const price2 = "1004445555";
    const price3 = "123";
    const price4 = "4567";
    const price5 = "891011";
    const price6 = "1213141516";
    const price7 = "234";
    const price8 = "5678";
    const price9 = "910910";
    const price10 = "10";

    const token1 = (await ship.deploy(Token__factory, { aliasName: "Token1", args: ["Token", "Token", 18] }))
      .contract;
    const token2 = (await ship.deploy(Token__factory, { aliasName: "Token2", args: ["Token", "Token", 18] }))
      .contract;
    const token3 = (await ship.deploy(Token__factory, { aliasName: "Token3", args: ["Token", "Token", 18] }))
      .contract;
    const token4 = (await ship.deploy(Token__factory, { aliasName: "Token4", args: ["Token", "Token", 18] }))
      .contract;
    const token5 = (await ship.deploy(Token__factory, { aliasName: "Token5", args: ["Token", "Token", 18] }))
      .contract;
    const token6 = (await ship.deploy(Token__factory, { aliasName: "Token6", args: ["Token", "Token", 18] }))
      .contract;
    const token7 = (await ship.deploy(Token__factory, { aliasName: "Token7", args: ["Token", "Token", 18] }))
      .contract;
    const token8 = (await ship.deploy(Token__factory, { aliasName: "Token8", args: ["Token", "Token", 18] }))
      .contract;
    const token9 = (await ship.deploy(Token__factory, { aliasName: "Token9", args: ["Token", "Token", 18] }))
      .contract;
    const token10 = (
      await ship.deploy(Token__factory, { aliasName: "Token10", args: ["Token", "Token", 18] })
    ).contract;

    await fastPriceFeed.connect(deployer).setTokens([token1.address, token2.address], [1000, 1000]);
    await fastPriceFeed.setMaxTimeDeviation(1000);

    let priceBitArray = getPriceBitArray([price1, price2]);
    let blockTime = await getTime();

    expect(priceBitArray.length).eq(1);

    await expect(
      fastPriceFeed.connect(alice).setCompactedPrices(priceBitArray, blockTime),
    ).to.be.revertedWith("FastPriceFeed: forbidden");

    await fastPriceFeed.connect(deployer).setUpdater(alice.address, true);

    expect(await fastPriceFeed.lastUpdatedAt()).eq(0);

    await fastPriceFeed.connect(alice).setCompactedPrices(priceBitArray, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(getExpandedPrice(price1, 1000));
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 1000));

    expect(await fastPriceFeed.lastUpdatedAt()).eq(blockTime);

    await fastPriceFeed.connect(deployer).setTokens([token1.address, token2.address], [1000, 10000]);

    blockTime = blockTime + 500;

    await fastPriceFeed.connect(alice).setCompactedPrices(priceBitArray, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(getExpandedPrice(price1, 1000));
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 10000));

    expect(await fastPriceFeed.lastUpdatedAt()).eq(blockTime);

    await fastPriceFeed
      .connect(deployer)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000],
      );

    priceBitArray = getPriceBitArray([price1, price2, price3, price4, price5, price6, price7]);

    expect(priceBitArray.length).eq(1);

    await fastPriceFeed.connect(alice).setCompactedPrices(priceBitArray, blockTime);

    const p1 = await fastPriceFeed.prices(token1.address);
    expect(utils.formatUnits(p1, 30)).eq("2009991.111");
    expect(await fastPriceFeed.prices(token1.address)).eq("2009991111000000000000000000000000000");
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 100));
    expect(await fastPriceFeed.prices(token3.address)).eq(getExpandedPrice(price3, 10));
    expect(await fastPriceFeed.prices(token4.address)).eq(getExpandedPrice(price4, 1000));
    expect(await fastPriceFeed.prices(token5.address)).eq(getExpandedPrice(price5, 10000));
    expect(await fastPriceFeed.prices(token6.address)).eq(getExpandedPrice(price6, 1000));
    expect(await fastPriceFeed.prices(token7.address)).eq(getExpandedPrice(price7, 1000));

    await fastPriceFeed
      .connect(deployer)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
          token8.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000, 100],
      );

    priceBitArray = getPriceBitArray([price1, price2, price3, price4, price5, price6, price7, price8]);

    expect(priceBitArray.length).eq(1);

    await fastPriceFeed.connect(alice).setCompactedPrices(priceBitArray, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(getExpandedPrice(price1, 1000));
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 100));
    expect(await fastPriceFeed.prices(token3.address)).eq(getExpandedPrice(price3, 10));
    expect(await fastPriceFeed.prices(token4.address)).eq(getExpandedPrice(price4, 1000));
    expect(await fastPriceFeed.prices(token5.address)).eq(getExpandedPrice(price5, 10000));
    expect(await fastPriceFeed.prices(token6.address)).eq(getExpandedPrice(price6, 1000));
    expect(await fastPriceFeed.prices(token7.address)).eq(getExpandedPrice(price7, 1000));
    expect(await fastPriceFeed.prices(token8.address)).eq(getExpandedPrice(price8, 100));

    await fastPriceFeed
      .connect(deployer)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
          token8.address,
          token9.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000, 100, 10],
      );

    priceBitArray = getPriceBitArray([
      price1,
      price2,
      price3,
      price4,
      price5,
      price6,
      price7,
      price8,
      price9,
    ]);

    expect(priceBitArray.length).eq(2);

    await fastPriceFeed.connect(alice).setCompactedPrices(priceBitArray, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(getExpandedPrice(price1, 1000));
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 100));
    expect(await fastPriceFeed.prices(token3.address)).eq(getExpandedPrice(price3, 10));
    expect(await fastPriceFeed.prices(token4.address)).eq(getExpandedPrice(price4, 1000));
    expect(await fastPriceFeed.prices(token5.address)).eq(getExpandedPrice(price5, 10000));
    expect(await fastPriceFeed.prices(token6.address)).eq(getExpandedPrice(price6, 1000));
    expect(await fastPriceFeed.prices(token7.address)).eq(getExpandedPrice(price7, 1000));
    expect(await fastPriceFeed.prices(token8.address)).eq(getExpandedPrice(price8, 100));
    expect(await fastPriceFeed.prices(token9.address)).eq(getExpandedPrice(price9, 10));

    await fastPriceFeed
      .connect(deployer)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
          token8.address,
          token9.address,
          token10.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000, 100, 10, 10000],
      );

    priceBitArray = getPriceBitArray([
      price1,
      price2,
      price3,
      price4,
      price5,
      price6,
      price7,
      price8,
      price9,
      price10,
    ]);

    expect(priceBitArray.length).eq(2);

    await fastPriceFeed.connect(alice).setCompactedPrices(priceBitArray, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(getExpandedPrice(price1, 1000));
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 100));
    expect(await fastPriceFeed.prices(token3.address)).eq(getExpandedPrice(price3, 10));
    expect(await fastPriceFeed.prices(token4.address)).eq(getExpandedPrice(price4, 1000));
    expect(await fastPriceFeed.prices(token5.address)).eq(getExpandedPrice(price5, 10000));
    expect(await fastPriceFeed.prices(token6.address)).eq(getExpandedPrice(price6, 1000));
    expect(await fastPriceFeed.prices(token7.address)).eq(getExpandedPrice(price7, 1000));
    expect(await fastPriceFeed.prices(token8.address)).eq(getExpandedPrice(price8, 100));
    expect(await fastPriceFeed.prices(token9.address)).eq(getExpandedPrice(price9, 10));
    expect(await fastPriceFeed.prices(token10.address)).eq(getExpandedPrice(price10, 10000));
  });

  it("setPricesWithBits", async () => {
    const price1 = "2009991111";
    const price2 = "1004445555";
    const price3 = "123";
    const price4 = "4567";
    const price5 = "891011";
    const price6 = "1213141516";
    const price7 = "234";
    const price8 = "5678";
    const price9 = "910910";
    const price10 = "10";

    const token1 = (await ship.deploy(Token__factory, { aliasName: "Token1", args: ["Token", "Token", 18] }))
      .contract;
    const token2 = (await ship.deploy(Token__factory, { aliasName: "Token2", args: ["Token", "Token", 18] }))
      .contract;
    const token3 = (await ship.deploy(Token__factory, { aliasName: "Token3", args: ["Token", "Token", 18] }))
      .contract;
    const token4 = (await ship.deploy(Token__factory, { aliasName: "Token4", args: ["Token", "Token", 18] }))
      .contract;
    const token5 = (await ship.deploy(Token__factory, { aliasName: "Token5", args: ["Token", "Token", 18] }))
      .contract;
    const token6 = (await ship.deploy(Token__factory, { aliasName: "Token6", args: ["Token", "Token", 18] }))
      .contract;
    const token7 = (await ship.deploy(Token__factory, { aliasName: "Token7", args: ["Token", "Token", 18] }))
      .contract;
    const token8 = (await ship.deploy(Token__factory, { aliasName: "Token8", args: ["Token", "Token", 18] }))
      .contract;
    const token9 = (await ship.deploy(Token__factory, { aliasName: "Token9", args: ["Token", "Token", 18] }))
      .contract;
    const token10 = (
      await ship.deploy(Token__factory, { aliasName: "Token10", args: ["Token", "Token", 18] })
    ).contract;

    await fastPriceFeed.connect(deployer).setTokens([token1.address, token2.address], [1000, 1000]);
    await fastPriceFeed.setMaxTimeDeviation(1000);

    let priceBits = getPriceBits([price1, price2]);
    let blockTime = await getTime();

    await expect(fastPriceFeed.connect(alice).setPricesWithBits(priceBits, blockTime)).to.be.revertedWith(
      "FastPriceFeed: forbidden",
    );

    await fastPriceFeed.connect(deployer).setUpdater(alice.address, true);

    expect(await fastPriceFeed.lastUpdatedAt()).eq(0);

    const tx0 = await fastPriceFeed.connect(alice).setPricesWithBits(priceBits, blockTime);
    await reportGasUsed(tx0, "tx0 setPricesWithBits gas used");

    expect(await fastPriceFeed.prices(token1.address)).eq(getExpandedPrice(price1, 1000));
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 1000));

    expect(await fastPriceFeed.lastUpdatedAt()).eq(blockTime);

    await fastPriceFeed.connect(deployer).setTokens([token1.address, token2.address], [1000, 10000]);

    blockTime = blockTime + 500;

    await fastPriceFeed.connect(alice).setPricesWithBits(priceBits, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(getExpandedPrice(price1, 1000));
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 10000));

    expect(await fastPriceFeed.lastUpdatedAt()).eq(blockTime);

    await fastPriceFeed
      .connect(deployer)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000],
      );

    priceBits = getPriceBits([price1, price2, price3, price4, price5, price6, price7]);

    const tx1 = await fastPriceFeed.connect(alice).setPricesWithBits(priceBits, blockTime);
    await reportGasUsed(tx1, "tx1 setPricesWithBits gas used");

    const p1 = await fastPriceFeed.prices(token1.address);
    expect(utils.formatUnits(p1, 30)).eq("2009991.111");
    expect(await fastPriceFeed.prices(token1.address)).eq("2009991111000000000000000000000000000");
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 100));
    expect(await fastPriceFeed.prices(token3.address)).eq(getExpandedPrice(price3, 10));
    expect(await fastPriceFeed.prices(token4.address)).eq(getExpandedPrice(price4, 1000));
    expect(await fastPriceFeed.prices(token5.address)).eq(getExpandedPrice(price5, 10000));
    expect(await fastPriceFeed.prices(token6.address)).eq(getExpandedPrice(price6, 1000));
    expect(await fastPriceFeed.prices(token7.address)).eq(getExpandedPrice(price7, 1000));

    await fastPriceFeed
      .connect(deployer)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
          token8.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000, 100],
      );

    priceBits = getPriceBits([price1, price2, price3, price4, price5, price6, price7, price8]);

    await fastPriceFeed.connect(alice).setPricesWithBits(priceBits, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(getExpandedPrice(price1, 1000));
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 100));
    expect(await fastPriceFeed.prices(token3.address)).eq(getExpandedPrice(price3, 10));
    expect(await fastPriceFeed.prices(token4.address)).eq(getExpandedPrice(price4, 1000));
    expect(await fastPriceFeed.prices(token5.address)).eq(getExpandedPrice(price5, 10000));
    expect(await fastPriceFeed.prices(token6.address)).eq(getExpandedPrice(price6, 1000));
    expect(await fastPriceFeed.prices(token7.address)).eq(getExpandedPrice(price7, 1000));
    expect(await fastPriceFeed.prices(token8.address)).eq(getExpandedPrice(price8, 100));

    priceBits = getPriceBits([price1, price2, price3, price4, price5, price6, price7, price9]);

    await advanceBlock();
    await fastPriceFeed.connect(alice).setPricesWithBits(priceBits, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(getExpandedPrice(price1, 1000));
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 100));
    expect(await fastPriceFeed.prices(token3.address)).eq(getExpandedPrice(price3, 10));
    expect(await fastPriceFeed.prices(token4.address)).eq(getExpandedPrice(price4, 1000));
    expect(await fastPriceFeed.prices(token5.address)).eq(getExpandedPrice(price5, 10000));
    expect(await fastPriceFeed.prices(token6.address)).eq(getExpandedPrice(price6, 1000));
    expect(await fastPriceFeed.prices(token7.address)).eq(getExpandedPrice(price7, 1000));
    expect(await fastPriceFeed.prices(token8.address)).eq(getExpandedPrice(price9, 100));

    priceBits = getPriceBits([price7, price1, price3, price4, price5, price6, price7, price8]);

    await advanceBlock();
    await fastPriceFeed.connect(alice).setPricesWithBits(priceBits, blockTime - 1);

    expect(await fastPriceFeed.prices(token1.address)).eq(getExpandedPrice(price1, 1000));
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price2, 100));
    expect(await fastPriceFeed.prices(token3.address)).eq(getExpandedPrice(price3, 10));
    expect(await fastPriceFeed.prices(token4.address)).eq(getExpandedPrice(price4, 1000));
    expect(await fastPriceFeed.prices(token5.address)).eq(getExpandedPrice(price5, 10000));
    expect(await fastPriceFeed.prices(token6.address)).eq(getExpandedPrice(price6, 1000));
    expect(await fastPriceFeed.prices(token7.address)).eq(getExpandedPrice(price7, 1000));
    expect(await fastPriceFeed.prices(token8.address)).eq(getExpandedPrice(price9, 100));

    await advanceBlock();
    await fastPriceFeed.connect(alice).setPricesWithBits(priceBits, blockTime + 1);

    expect(await fastPriceFeed.prices(token1.address)).eq(getExpandedPrice(price7, 1000));
    expect(await fastPriceFeed.prices(token2.address)).eq(getExpandedPrice(price1, 100));
    expect(await fastPriceFeed.prices(token3.address)).eq(getExpandedPrice(price3, 10));
    expect(await fastPriceFeed.prices(token4.address)).eq(getExpandedPrice(price4, 1000));
    expect(await fastPriceFeed.prices(token5.address)).eq(getExpandedPrice(price5, 10000));
    expect(await fastPriceFeed.prices(token6.address)).eq(getExpandedPrice(price6, 1000));
    expect(await fastPriceFeed.prices(token7.address)).eq(getExpandedPrice(price7, 1000));
    expect(await fastPriceFeed.prices(token8.address)).eq(getExpandedPrice(price8, 100));
  });

  it("price data check", async () => {
    await fastPriceFeed.connect(deployer).setUpdater(alice.address, true);
    await fastPriceFeed.setMaxTimeDeviation(20000);
    await fastPriceFeed.setMinBlockInterval(0);
    await fastPriceFeed.connect(deployer).setPriceDataInterval(300);
    await fastPriceFeed
      .connect(deployer)
      .setMaxCumulativeDeltaDiffs(
        [avax.address, eth.address],
        [(7 * 10 * 1000 * 1000) / 100, (7 * 10 * 1000 * 1000) / 100],
      );

    let blockTime = await getTime();
    const tx0 = await fastPriceFeed.connect(alice).setPrices([avax.address], [500], blockTime);
    await reportGasUsed(tx0, "tx0 setPrices gas used");

    await fastPriceFeed.setVaultPriceFeed(vaultPriceFeed.address);
    expect(await fastPriceFeed.vaultPriceFeed()).eq(vaultPriceFeed.address);

    let priceData = await fastPriceFeed.getPriceData(avax.address);
    expect(priceData[0]).eq(0);
    expect(priceData[1]).eq(0);
    expect(priceData[2]).eq(0);
    expect(priceData[3]).eq(0);

    await avaxPriceFeed.setLatestAnswer(600);

    blockTime = await getTime();
    const tx1 = await fastPriceFeed.connect(alice).setPrices([avax.address], [550], blockTime);
    await reportGasUsed(tx1, "tx1 setPrices gas used");

    priceData = await fastPriceFeed.getPriceData(avax.address);
    expect(await priceData[0]).eq(600);
    expect(await priceData[1]).gt(blockTime - 10);
    expect(await priceData[1]).lt(blockTime + 10);
    expect(await priceData[2]).eq(0);
    expect(await priceData[3]).eq(0);
    expect(await fastPriceFeed.favorFastPrice(avax.address)).eq(true);
    expect(await fastPriceFeed.favorFastPrice(eth.address)).eq(true);

    const tx2 = await fastPriceFeed.connect(alice).setPrices([avax.address], [580], blockTime + 1);
    await reportGasUsed(tx2, "tx2 setPrices gas used");

    priceData = await fastPriceFeed.getPriceData(avax.address);
    expect(await priceData[0]).eq(600);
    expect(await priceData[2]).eq(0);
    expect(await priceData[3]).eq(545454); // 545454 / (10 * 1000 * 1000) => ~5.45%, (30 / 550)
    expect(await fastPriceFeed.favorFastPrice(avax.address)).eq(true);
    expect(await fastPriceFeed.favorFastPrice(eth.address)).eq(true);

    await avaxPriceFeed.setLatestAnswer(590);
    const tx3 = await fastPriceFeed.connect(alice).setPrices([avax.address], [560], blockTime + 2);
    await reportGasUsed(tx3, "tx3 setPrices gas used");

    priceData = await fastPriceFeed.getPriceData(avax.address);
    expect(await priceData[0]).eq(590);
    expect(await priceData[2]).eq(166666); // 166666 / (10 * 1000 * 1000) => ~1.66%, (10 / 600)
    expect(await priceData[3]).eq(890281); // 890281 / (10 * 1000 * 1000) => ~8.90%, (30 / 550 + 20 / 580)
    expect(await fastPriceFeed.favorFastPrice(avax.address)).eq(false);
    expect(await fastPriceFeed.favorFastPrice(eth.address)).eq(true);

    await advanceTimeAndBlock(1000);

    await avaxPriceFeed.setLatestAnswer(580);

    await fastPriceFeed.connect(alice).setPrices([avax.address], [570], blockTime + 3);
    priceData = await fastPriceFeed.getPriceData(avax.address);
    expect(await priceData[0]).eq(580);
    expect(await priceData[2]).eq(169491); // 169491 / (10 * 1000 * 1000) => 1.69%, (10 / 590)
    expect(await priceData[3]).eq(178571); // 178571 / (10 * 1000 * 1000) => ~1.78%, (10 / 560)
    expect(await fastPriceFeed.favorFastPrice(avax.address)).eq(true);

    await fastPriceFeed.connect(alice).setPrices([avax.address], [5700], blockTime + 4);
    priceData = await fastPriceFeed.getPriceData(avax.address);
    expect(await priceData[0]).eq(580);
    expect(await priceData[2]).eq(169491); // 169491 / (10 * 1000 * 1000) => 1.69%, (10 / 590)
    expect(await priceData[3]).eq(90178571); // 90178571 / (10 * 1000 * 1000) => ~901.78%, ((5700 - 570) / 570 + 10 / 560)
    expect(await fastPriceFeed.favorFastPrice(avax.address)).eq(false);
  });
});
