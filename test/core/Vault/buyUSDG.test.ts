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
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";
import { validateVaultBalance } from "./shared";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let usdg: USDG;
let btc: Token;
let btcPriceFeed: PriceFeed;
let usdc: Token;
let usdcPriceFeed: PriceFeed;
let avax: Token;
let avaxPriceFeed: PriceFeed;

let xlxManager: XlxManager;

let deployer: SignerWithAddress;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

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

describe("Vault.buyUSDG", function () {
  beforeEach(async function () {
    const { accounts } = await setup();

    deployer = accounts.deployer;
    alice = accounts.alice;
    bob = accounts.bob;

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
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

  it("buyUSDG", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    await expect(vault.connect(alice).buyUSDG(avax.address, bob.address)).to.be.revertedWith(
      "Vault: invalid tokenAmount",
    );

    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(0);
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.poolAmounts(avax.address)).eq(0);

    await avax.mint(alice.address, 100);
    await avax.connect(alice).transfer(vault.address, 100);
    const tx = await vault.connect(alice).buyUSDG(avax.address, bob.address, { gasPrice: "10000000000" });
    await reportGasUsed(tx, "buyUSDG gas used");

    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(29700);
    expect(await vault.feeReserves(avax.address)).eq(1);
    expect(await vault.usdgAmounts(avax.address)).eq(29700);
    expect(await vault.poolAmounts(avax.address)).eq(100 - 1);

    await validateVaultBalance(vault, avax);

    expect(await xlxManager.getAumInUsdg(true)).eq(29700);
  });

  it("buyUSDG allows gov to mint", async () => {
    await vault.setInManagerMode(true);
    await expect(vault.buyUSDG(avax.address, deployer.address)).to.be.revertedWith("Vault: forbidden");

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    await avax.mint(deployer.address, 100);
    await avax.transfer(vault.address, 100);

    expect(await usdg.balanceOf(deployer.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(0);
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.poolAmounts(avax.address)).eq(0);

    await expect(vault.connect(alice).buyUSDG(avax.address, deployer.address)).to.be.revertedWith(
      "Vault: forbidden",
    );

    // await vault.setManager(alice.address, true);
    // await vault.connect(alice).buyUSDG(avax.address, deployer.address);

    // expect(await usdg.balanceOf(deployer.address)).eq(29700);
    // expect(await vault.feeReserves(avax.address)).eq(1);
    // expect(await vault.usdgAmounts(avax.address)).eq(29700);
    // expect(await vault.poolAmounts(avax.address)).eq(100 - 1);

    // await validateVaultBalance(vault, avax);
  });

  it("buyUSDG uses min price", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(200));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(250));

    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(0);
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.poolAmounts(avax.address)).eq(0);
    await avax.mint(alice.address, 100);
    await avax.connect(alice).transfer(vault.address, 100);
    await vault.connect(alice).buyUSDG(avax.address, bob.address);
    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(19800);
    expect(await vault.feeReserves(avax.address)).eq(1);
    expect(await vault.usdgAmounts(avax.address)).eq(19800);
    expect(await vault.poolAmounts(avax.address)).eq(100 - 1);

    await validateVaultBalance(vault, avax);
  });

  it("buyUSDG updates fees", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(0);
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.poolAmounts(avax.address)).eq(0);
    await avax.mint(alice.address, 10000);
    await avax.connect(alice).transfer(vault.address, 10000);
    await vault.connect(alice).buyUSDG(avax.address, bob.address);
    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(9970 * 300);
    expect(await vault.feeReserves(avax.address)).eq(30);
    expect(await vault.usdgAmounts(avax.address)).eq(9970 * 300);
    expect(await vault.poolAmounts(avax.address)).eq(10000 - 30);

    await validateVaultBalance(vault, avax);
  });

  it("buyUSDG uses mintBurnFeeBasisPoints", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

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

    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(avax.address)).eq(0);
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.poolAmounts(avax.address)).eq(0);
    await usdc.mint(alice.address, toWei(10000, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(10000, 6));
    await vault.connect(alice).buyUSDG(usdc.address, bob.address);
    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(toWei(10000 - 4, 18));
    expect(await vault.feeReserves(usdc.address)).eq(toWei(4, 6));
    expect(await vault.usdgAmounts(usdc.address)).eq(toWei(10000 - 4, 18));
    expect(await vault.poolAmounts(usdc.address)).eq(toWei(10000 - 4, 6));
  });

  it("buyUSDG adjusts for decimals", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await expect(vault.connect(alice).buyUSDG(btc.address, bob.address)).to.be.revertedWith(
      "Vault: invalid tokenAmount",
    );

    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await usdg.balanceOf(bob.address)).eq(0);
    expect(await vault.feeReserves(btc.address)).eq(0);
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.poolAmounts(avax.address)).eq(0);
    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(alice).transfer(vault.address, toWei(1, 8));
    await vault.connect(alice).buyUSDG(btc.address, bob.address);
    expect(await usdg.balanceOf(alice.address)).eq(0);
    expect(await vault.feeReserves(btc.address)).eq(300000);
    expect(await usdg.balanceOf(bob.address)).eq(toWei(60000, 18).sub(toWei(180, 18))); // 0.3% of 60,000 => 180
    expect(await vault.usdgAmounts(btc.address)).eq(toWei(60000, 18).sub(toWei(180, 18)));
    expect(await vault.poolAmounts(btc.address)).eq(toWei(1, 8).sub(300000));

    await validateVaultBalance(vault, btc);
  });
});
