import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VaultPriceFeed__factory,
  Token,
  Vault__factory,
  USDG,
  USDG__factory,
  Vault,
  VaultPriceFeed,
  PriceFeed,
  XlxManager,
  XlxManager__factory,
  Router,
  Router__factory,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let router: Router;
let usdg: USDG;
let btc: Token;
let btcPriceFeed: PriceFeed;
let usdc: Token;
let usdcPriceFeed: PriceFeed;
let avax: Token;
let avaxPriceFeed: PriceFeed;

let xlxManager: XlxManager;

let alice: SignerWithAddress;
let bob: SignerWithAddress;
let user: SignerWithAddress;
let user1: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["vault", "vaultPriceFeed", "usdg", "tokens", "xlxManager", "router"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("Vault.sellUSDG", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    alice = accounts.alice;
    bob = accounts.bob;
    user = users[0];
    user1 = users[1];

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    router = await ship.connect(Router__factory);
    usdg = await ship.connect(USDG__factory);
    xlxManager = await ship.connect(XlxManager__factory);

    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    usdcPriceFeed = (await ship.connect("usdcPriceFeed")) as PriceFeed;
    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;

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

  it("sellUSDG", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await avax.mint(alice.address, 100);

    expect(await xlxManager.getAumInUsdg(true)).eq(0);
    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(0);
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.poolAmounts(avax.address)).eq(0);
    expect(await avax.balanceOf(alice.address)).eq(100);
    await avax.connect(alice).transfer(vault.address, 100);
    await vault.connect(alice).buyUSDG(avax.address, alice.address);
    expect(await usdg.balanceOf(alice.address)).eq(29700);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(1);
    expect(await vault.usdgAmounts(avax.address)).eq(29700);
    expect(await vault.poolAmounts(avax.address)).eq(100 - 1);
    expect(await avax.balanceOf(alice.address)).eq(0);
    expect(await xlxManager.getAumInUsdg(true)).eq(29700);

    await expect(vault.connect(alice).sellUSDG(avax.address, bob.address)).to.be.revertedWith(
      "Vault: invalid usdgAmount",
    );

    await usdg.connect(alice).transfer(vault.address, 15000);

    await expect(vault.connect(alice).sellUSDG(btc.address, bob.address)).to.be.revertedWith(
      "Vault: invalid redemptionAmount",
    );

    await vault.setInManagerMode(true);
    await expect(vault.connect(alice).sellUSDG(avax.address, bob.address)).to.be.revertedWith(
      "Vault: forbidden",
    );

    await vault.setManager(alice.address, true);

    const tx = await vault.connect(alice).sellUSDG(avax.address, bob.address, { gasPrice: "10000000000" });
    await reportGasUsed(tx, "sellUSDG gas used");
    expect(await usdg.balanceOf(alice.address)).eq(29700 - 15000);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(2);
    expect(await vault.usdgAmounts(avax.address)).eq(29700 - 15000);
    expect(await vault.poolAmounts(avax.address)).eq(100 - 1 - 50);
    expect(await avax.balanceOf(alice.address)).eq(0);
    expect(await avax.balanceOf(bob.address)).eq(50 - 1); // (15000 / 300) => 50
    expect(await xlxManager.getAumInUsdg(true)).eq(29700 - 15000);
  });

  it("sellUSDG after a price increase", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await avax.mint(alice.address, 100);

    expect(await xlxManager.getAumInUsdg(true)).eq(0);
    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(0);
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.poolAmounts(avax.address)).eq(0);
    expect(await avax.balanceOf(alice.address)).eq(100);
    await avax.connect(alice).transfer(vault.address, 100);
    await vault.connect(alice).buyUSDG(avax.address, alice.address);

    expect(await usdg.balanceOf(alice.address)).eq(29700);
    expect(await usdg.balanceOf(bob.address)).eq(0);

    expect(await vault.feeReserves(avax.address)).eq(1);
    expect(await vault.usdgAmounts(avax.address)).eq(29700);
    expect(await vault.poolAmounts(avax.address)).eq(100 - 1);
    expect(await avax.balanceOf(alice.address)).eq(0);
    expect(await xlxManager.getAumInUsdg(true)).eq(29700);

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(400));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(600));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    expect(await xlxManager.getAumInUsdg(false)).eq(39600);

    await usdg.connect(alice).transfer(vault.address, 15000);
    await vault.connect(alice).sellUSDG(avax.address, bob.address);

    expect(await usdg.balanceOf(alice.address)).eq(29700 - 15000);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(2);
    expect(await vault.usdgAmounts(avax.address)).eq(29700 - 15000);
    expect(await vault.poolAmounts(avax.address)).eq(100 - 1 - 25);
    expect(await avax.balanceOf(alice.address)).eq(0);
    expect(await avax.balanceOf(bob.address)).eq(25 - 1); // (15000 / 600) => 25
    expect(await xlxManager.getAumInUsdg(false)).eq(29600);
  });

  it("sellUSDG redeem based on price", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await btc.mint(alice.address, toWei(2, 8));

    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(btc.address)).eq(0);
    expect(await vault.usdgAmounts(btc.address)).eq(0);
    expect(await vault.poolAmounts(btc.address)).eq(0);
    expect(await btc.balanceOf(alice.address)).eq(toWei(2, 8));

    expect(await xlxManager.getAumInUsdg(true)).eq(0);
    await btc.connect(alice).transfer(vault.address, toWei(2, 8));
    await vault.connect(alice).buyUSDG(btc.address, alice.address);
    expect(await xlxManager.getAumInUsdg(true)).eq("119640000000000000000000"); // 119,640

    expect(await usdg.balanceOf(alice.address)).eq("119640000000000000000000"); // 119,640
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(btc.address)).eq("600000"); // 0.006 BTC, 2 * 0.03%
    expect(await vault.usdgAmounts(btc.address)).eq("119640000000000000000000"); // 119,640
    expect(await vault.poolAmounts(btc.address)).eq("199400000"); // 1.994 BTC
    expect(await btc.balanceOf(alice.address)).eq(0);
    expect(await btc.balanceOf(bob.address)).eq(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(82000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(80000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(83000));

    expect(await xlxManager.getAumInUsdg(false)).eq(toWei(159520, 18)); // 199400000 / (10 ** 8) * 80,000
    await usdg.connect(alice).transfer(vault.address, toWei(10000, 18));
    await vault.connect(alice).sellUSDG(btc.address, bob.address);

    expect(await btc.balanceOf(bob.address)).eq("12012047"); // 0.12012047 BTC, 0.12012047 * 83000 => 9969.999
    expect(await vault.feeReserves(btc.address)).eq("636145"); // 0.00636145
    expect(await vault.poolAmounts(btc.address)).eq("187351808"); // 199400000-(636145-600000)-12012047 => 187351808
    expect(await xlxManager.getAumInUsdg(false)).eq("149881446400000000000000"); // 149881.4464, 187351808 / (10 ** 8) * 80,000
  });

  it("sellUSDG for stableTokens", async () => {
    await vault.setFees(
      50, // _taxBasisPoints
      10, // _stableTaxBasisPoints
      4, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      0, // _minProfitTime
      false, // _hasDynamicFees
    );

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await usdc.mint(alice.address, toWei(10000, 6));

    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(usdc.address)).eq(0);
    expect(await vault.usdgAmounts(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq(0);
    expect(await usdc.balanceOf(alice.address)).eq(toWei(10000, 6));
    expect(await xlxManager.getAumInUsdg(true)).eq(0);

    await usdc.connect(alice).transfer(vault.address, toWei(10000, 6));
    await vault.connect(alice).buyUSDG(usdc.address, alice.address);

    expect(await xlxManager.getAumInUsdg(true)).eq(toWei(9996, 18));
    expect(await usdg.balanceOf(alice.address)).eq(toWei(9996, 18));
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(usdc.address)).eq(toWei(4, 6));
    expect(await vault.usdgAmounts(usdc.address)).eq(toWei(9996, 18));
    expect(await vault.poolAmounts(usdc.address)).eq(toWei(9996, 6));
    expect(await usdc.balanceOf(alice.address)).eq(0);
    expect(await usdc.balanceOf(bob.address)).eq(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(5000));

    await btc.mint(alice.address, toWei(1, 8));

    expect(await usdc.balanceOf(user.address)).eq(0);

    await btc.connect(alice).transfer(vault.address, toWei(1, 8));
    await vault.connect(alice).swap(btc.address, usdc.address, user.address);

    expect(await xlxManager.getAumInUsdg(true)).eq(toWei(64996, 18));

    expect(await vault.feeReserves(usdc.address)).eq(toWei(19, 6));
    expect(await vault.usdgAmounts(usdc.address)).eq(toWei(4996, 18));
    expect(await vault.poolAmounts(usdc.address)).eq(toWei(4996, 6));

    expect(await vault.feeReserves(btc.address)).eq(0);
    expect(await vault.usdgAmounts(btc.address)).eq(toWei(5000, 18));
    expect(await vault.poolAmounts(btc.address)).eq(toWei(1, 8));

    expect(await usdc.balanceOf(user.address)).eq(toWei(4985, 6));

    await usdg.connect(alice).approve(router.address, toWei(5000, 18));
    await expect(
      router.connect(alice).swap([usdg.address, usdc.address], toWei(5000, 18), 0, user1.address),
    ).to.be.revertedWith("Vault: poolAmount exceeded");

    expect(await usdc.balanceOf(user1.address)).eq(0);
    await router.connect(alice).swap([usdg.address, usdc.address], toWei(4000, 18), 0, user1.address);
    expect(await usdc.balanceOf(user1.address)).eq("3998400000"); // 3998.4

    expect(await vault.feeReserves(usdc.address)).eq("20600000"); // 20.6
    expect(await vault.usdgAmounts(usdc.address)).eq(toWei(996, 18));
    expect(await vault.poolAmounts(usdc.address)).eq(toWei(996, 6));

    expect(await xlxManager.getAumInUsdg(true)).eq(toWei(60996, 18));
  });
});
