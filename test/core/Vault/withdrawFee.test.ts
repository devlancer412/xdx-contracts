import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VaultPriceFeed__factory,
  Token,
  Vault__factory,
  Vault,
  VaultPriceFeed,
  PriceFeed,
  XlxManager,
  XlxManager__factory,
  USDG,
  USDG__factory,
  Timelock__factory,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let usdg: USDG;
let btc: Token;
let btcPriceFeed: PriceFeed;
let avax: Token;
let avaxPriceFeed: PriceFeed;
let usdc: Token;
let usdcPriceFeed: PriceFeed;

let xlxManager: XlxManager;

let deployer: SignerWithAddress;
let alice: SignerWithAddress;
let bob: SignerWithAddress;
let user: SignerWithAddress;
let user1: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["vault", "vaultPriceFeed", "usdg", "tokens", "xlxManager"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("Vault.withdrawFee", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    alice = accounts.alice;
    bob = accounts.bob;
    user = users[0];
    user1 = users[1];

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    xlxManager = await ship.connect(XlxManager__factory);
    usdg = await ship.connect(USDG__factory);

    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    usdcPriceFeed = (await ship.connect("usdcPriceFeed")) as PriceFeed;

    await vault.setFees(
      50, // _taxBasisPoints
      20, // _stableTaxBasisPoints
      30, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      60 * 60, // _minProfitTime
      false, // _hasDynamicFees
    );
    await vault.setFundingRate(60 * 60, 600, 600);

    await xlxManager.setCooldownDuration(24 * 60 * 60);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    await xlxManager.setInPrivateMode(false);
    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);

    await vault.setInManagerMode(false);
  });

  it("withdrawFees", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await avax.mint(alice.address, toWei(900, 18));
    await avax.connect(alice).transfer(vault.address, toWei(900, 18));

    expect(await usdg.balanceOf(deployer.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(0);
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.poolAmounts(avax.address)).eq(0);

    await vault.connect(alice).buyUSDG(avax.address, bob.address);

    expect(await usdg.balanceOf(deployer.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq("269190000000000000000000"); // 269,190 USDG, 810 fee
    expect(await vault.feeReserves(avax.address)).eq("2700000000000000000"); // 2.7, 900 * 0.3%
    expect(await vault.usdgAmounts(avax.address)).eq("269190000000000000000000"); // 269,190
    expect(await vault.poolAmounts(avax.address)).eq("897300000000000000000"); // 897.3
    expect(await usdg.totalSupply()).eq("269190000000000000000000");

    await avax.mint(alice.address, toWei(200, 18));
    await avax.connect(alice).transfer(vault.address, toWei(200, 18));

    await btc.mint(alice.address, toWei(2, 8));
    await btc.connect(alice).transfer(vault.address, toWei(2, 8));

    await vault.connect(alice).buyUSDG(btc.address, bob.address);
    expect(await vault.usdgAmounts(btc.address)).eq("119640000000000000000000"); // 119,640
    expect(await usdg.totalSupply()).eq("388830000000000000000000"); // 388,830

    await btc.mint(alice.address, toWei(2, 8));
    await btc.connect(alice).transfer(vault.address, toWei(2, 8));

    await vault.connect(alice).buyUSDG(btc.address, bob.address);
    expect(await vault.usdgAmounts(btc.address)).eq("239280000000000000000000"); // 239,280
    expect(await usdg.totalSupply()).eq("508470000000000000000000"); // 508,470

    expect(await vault.usdgAmounts(avax.address)).eq("269190000000000000000000"); // 269,190
    expect(await vault.poolAmounts(avax.address)).eq("897300000000000000000"); // 897.3

    await vault.connect(alice).buyUSDG(avax.address, bob.address);

    expect(await vault.usdgAmounts(avax.address)).eq("329010000000000000000000"); // 329,010
    expect(await vault.poolAmounts(avax.address)).eq("1096700000000000000000"); // 1096.7

    expect(await vault.feeReserves(avax.address)).eq("3300000000000000000"); // 3.3 avax
    expect(await vault.feeReserves(btc.address)).eq("1200000"); // 0.012 BTC

    await expect(vault.connect(alice).withdrawFees(avax.address, user.address)).to.be.revertedWith(
      "Vault: forbidden",
    );

    expect(await avax.balanceOf(user.address)).eq(0);
    await vault.withdrawFees(avax.address, user.address);
    expect(await avax.balanceOf(user.address)).eq("3300000000000000000");

    expect(await btc.balanceOf(user.address)).eq(0);
    await vault.withdrawFees(btc.address, user.address);
    expect(await btc.balanceOf(user.address)).eq("1200000");
  });

  it("withdrawFees using timelock", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await avax.mint(alice.address, toWei(900, 18));
    await avax.connect(alice).transfer(vault.address, toWei(900, 18));

    expect(await usdg.balanceOf(deployer.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(0);
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.poolAmounts(avax.address)).eq(0);

    await vault.connect(alice).buyUSDG(avax.address, bob.address);

    expect(await usdg.balanceOf(deployer.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq("269190000000000000000000"); // 269,190 USDG, 810 fee
    expect(await vault.feeReserves(avax.address)).eq("2700000000000000000"); // 2.7, 900 * 0.3%
    expect(await vault.usdgAmounts(avax.address)).eq("269190000000000000000000"); // 269,190
    expect(await vault.poolAmounts(avax.address)).eq("897300000000000000000"); // 897.3
    expect(await usdg.totalSupply()).eq("269190000000000000000000");

    await avax.mint(alice.address, toWei(200, 18));
    await avax.connect(alice).transfer(vault.address, toWei(200, 18));

    await btc.mint(alice.address, toWei(2, 8));
    await btc.connect(alice).transfer(vault.address, toWei(2, 8));

    await vault.connect(alice).buyUSDG(btc.address, bob.address);
    expect(await vault.usdgAmounts(btc.address)).eq("119640000000000000000000"); // 119,640
    expect(await usdg.totalSupply()).eq("388830000000000000000000"); // 388,830

    await btc.mint(alice.address, toWei(2, 8));
    await btc.connect(alice).transfer(vault.address, toWei(2, 8));

    await vault.connect(alice).buyUSDG(btc.address, bob.address);
    expect(await vault.usdgAmounts(btc.address)).eq("239280000000000000000000"); // 239,280
    expect(await usdg.totalSupply()).eq("508470000000000000000000"); // 508,470

    expect(await vault.usdgAmounts(avax.address)).eq("269190000000000000000000"); // 269,190
    expect(await vault.poolAmounts(avax.address)).eq("897300000000000000000"); // 897.3

    await vault.connect(alice).buyUSDG(avax.address, bob.address);

    expect(await vault.usdgAmounts(avax.address)).eq("329010000000000000000000"); // 329,010
    expect(await vault.poolAmounts(avax.address)).eq("1096700000000000000000"); // 1096.7

    expect(await vault.feeReserves(avax.address)).eq("3300000000000000000"); // 3.3 avax
    expect(await vault.feeReserves(btc.address)).eq("1200000"); // 0.012 BTC

    await expect(vault.connect(alice).withdrawFees(avax.address, user.address)).to.be.revertedWith(
      "Vault: forbidden",
    );

    const timelock = (
      await ship.deploy(Timelock__factory, {
        args: [
          deployer.address, // _admin
          5 * 24 * 60 * 60, // _buffer
          alice.address, // _tokenManager
          bob.address, // _mintReceiver
          user.address, // _glpManager
          user1.address, // _rewardRouter
          toWei(1000, 18), // _maxTokenSupply
          10, // marginFeeBasisPoints
          100, // maxMarginFeeBasisPoints
        ],
      })
    ).contract;
    await vault.setGov(timelock.address);

    await expect(
      timelock.connect(alice).withdrawFees(vault.address, avax.address, user.address),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await avax.balanceOf(user.address)).eq(0);
    await timelock.withdrawFees(vault.address, avax.address, user.address);
    expect(await avax.balanceOf(user.address)).eq("3300000000000000000");

    expect(await btc.balanceOf(user.address)).eq(0);
    await timelock.withdrawFees(vault.address, btc.address, user.address);
    expect(await btc.balanceOf(user.address)).eq("1200000");
  });

  it("batchWithdrawFees using timelock", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await avax.mint(alice.address, toWei(900, 18));
    await avax.connect(alice).transfer(vault.address, toWei(900, 18));

    expect(await usdg.balanceOf(deployer.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(0);
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.poolAmounts(avax.address)).eq(0);

    await vault.connect(alice).buyUSDG(avax.address, bob.address);

    expect(await usdg.balanceOf(deployer.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq("269190000000000000000000"); // 269,190 USDG, 810 fee
    expect(await vault.feeReserves(avax.address)).eq("2700000000000000000"); // 2.7, 900 * 0.3%
    expect(await vault.usdgAmounts(avax.address)).eq("269190000000000000000000"); // 269,190
    expect(await vault.poolAmounts(avax.address)).eq("897300000000000000000"); // 897.3
    expect(await usdg.totalSupply()).eq("269190000000000000000000");

    await avax.mint(alice.address, toWei(200, 18));
    await avax.connect(alice).transfer(vault.address, toWei(200, 18));

    await btc.mint(alice.address, toWei(2, 8));
    await btc.connect(alice).transfer(vault.address, toWei(2, 8));

    await vault.connect(alice).buyUSDG(btc.address, bob.address);
    expect(await vault.usdgAmounts(btc.address)).eq("119640000000000000000000"); // 119,640
    expect(await usdg.totalSupply()).eq("388830000000000000000000"); // 388,830

    await btc.mint(alice.address, toWei(2, 8));
    await btc.connect(alice).transfer(vault.address, toWei(2, 8));

    await vault.connect(alice).buyUSDG(btc.address, bob.address);
    expect(await vault.usdgAmounts(btc.address)).eq("239280000000000000000000"); // 239,280
    expect(await usdg.totalSupply()).eq("508470000000000000000000"); // 508,470

    expect(await vault.usdgAmounts(avax.address)).eq("269190000000000000000000"); // 269,190
    expect(await vault.poolAmounts(avax.address)).eq("897300000000000000000"); // 897.3

    await vault.connect(alice).buyUSDG(avax.address, bob.address);

    expect(await vault.usdgAmounts(avax.address)).eq("329010000000000000000000"); // 329,010
    expect(await vault.poolAmounts(avax.address)).eq("1096700000000000000000"); // 1096.7

    expect(await vault.feeReserves(avax.address)).eq("3300000000000000000"); // 3.3 avax
    expect(await vault.feeReserves(btc.address)).eq("1200000"); // 0.012 BTC

    await expect(vault.connect(alice).withdrawFees(avax.address, user.address)).to.be.revertedWith(
      "Vault: forbidden",
    );

    const timelock = (
      await ship.deploy(Timelock__factory, {
        args: [
          deployer.address, // _admin
          5 * 24 * 60 * 60, // _buffer
          alice.address, // _tokenManager
          bob.address, // _mintReceiver
          user.address, // _glpManager
          user1.address, // _rewardRouter
          toWei(1000, 18), // _maxTokenSupply
          10, // marginFeeBasisPoints
          100, // maxMarginFeeBasisPoints
        ],
      })
    ).contract;
    await vault.setGov(timelock.address);

    await expect(
      timelock.connect(alice).batchWithdrawFees(vault.address, [avax.address, btc.address]),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await avax.balanceOf(deployer.address)).eq(0);
    expect(await btc.balanceOf(deployer.address)).eq(0);

    expect(await timelock.admin()).eq(deployer.address);
    await timelock.batchWithdrawFees(vault.address, [avax.address, btc.address]);

    expect(await avax.balanceOf(deployer.address)).eq("3300000000000000000");
    expect(await btc.balanceOf(deployer.address)).eq("1200000");
  });
});
