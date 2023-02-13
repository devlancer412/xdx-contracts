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
let user: SignerWithAddress;

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

describe("Vault.closeLongPosition", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    alice = accounts.alice;
    bob = accounts.bob;
    user = users[0];

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

  it("close long position", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(bob.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, bob.address);

    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(110), true),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(90), true);

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45100));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(46100));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(47100));

    expect(await vault.feeReserves(btc.address)).eq(969);
    expect(await vault.reservedAmounts(btc.address)).eq(225000);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219);
    expect(await btc.balanceOf(user.address)).eq(0);

    const delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(9));

    const tx = await vault
      .connect(alice)
      .decreasePosition(alice.address, btc.address, btc.address, toUsd(4), toUsd(90), true, user.address);
    await reportGasUsed(tx, "decreasePosition gas used");

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true);

    expect(await vault.feeReserves(btc.address)).eq(969 + 191); // 0.00000191 * 47100 => ~0.09 USD
    expect(await vault.reservedAmounts(btc.address)).eq(0);
    expect(await vault.guaranteedUsd(btc.address)).eq(0);
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219 - 39957 - 191); // 0.00040148 * 47100 => ~18.9 USD
    expect(await btc.balanceOf(user.address)).eq(39957); // 0.00039957 * 47100 => 18.82 USD

    await validateVaultBalance(vault, btc);
  });

  it("close long position with loss", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(bob.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, bob.address);

    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(110), true),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(90), true);

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));

    expect(await vault.feeReserves(btc.address)).eq(969);
    expect(await vault.reservedAmounts(btc.address)).eq(225000);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219);
    expect(await btc.balanceOf(user.address)).eq(0);

    const delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("4390243902439024390243902439024"); // 4.39

    const tx = await vault
      .connect(alice)
      .decreasePosition(alice.address, btc.address, btc.address, toUsd(4), toUsd(90), true, user.address);
    await reportGasUsed(tx, "decreasePosition gas used");

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true);

    expect(await vault.feeReserves(btc.address)).eq(969 + 230); // 0.00000230 * 39000 => ~0.09 USD
    expect(await vault.reservedAmounts(btc.address)).eq(0);
    expect(await vault.guaranteedUsd(btc.address)).eq(0);
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219 - 13923 - 230); // 0.00013923 * 39000 => ~5.42 USD
    expect(await btc.balanceOf(user.address)).eq(13922); // 0.00013922 * 39000 => 5.42958 USD

    await validateVaultBalance(vault, btc, 1);
  });
});
