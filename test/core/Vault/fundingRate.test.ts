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
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { advanceTimeAndBlock, reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";
import { validateVaultBalance } from "./shared";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let usdcPriceFeed: PriceFeed;

let xlxManager: XlxManager;

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

describe("Vault.fundingRate", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    alice = accounts.alice;
    bob = accounts.bob;
    user = users[0];

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    xlxManager = await ship.connect(XlxManager__factory);

    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
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

  it("funding rate", async () => {
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

    let leverage = await vault.getPositionLeverage(alice.address, btc.address, btc.address, true);
    expect(leverage).eq(90817); // ~9X leverage

    expect(await vault.feeReserves(btc.address)).eq(969);
    expect(await vault.reservedAmounts(btc.address)).eq(225000);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219);
    expect(await btc.balanceOf(user.address)).eq(0);

    const tx0 = await vault
      .connect(alice)
      .decreasePosition(alice.address, btc.address, btc.address, toUsd(3), toUsd(50), true, user.address);
    await reportGasUsed(tx0, "decreasePosition gas used");

    leverage = await vault.getPositionLeverage(alice.address, btc.address, btc.address, true);
    expect(leverage).eq(57887); // ~5.8X leverage

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(9.91 - 3)); // collateral
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq((225000 / 90) * 40); // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(toUsd(5)); // pnl
    expect(position[6]).eq(true);

    expect(await vault.feeReserves(btc.address)).eq(969 + 106); // 0.00000106 * 45100 => ~0.05 USD
    expect(await vault.reservedAmounts(btc.address)).eq((225000 / 90) * 40);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(33.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 16878 - 106 - 1 - 219); // 257046
    expect(await btc.balanceOf(user.address)).eq(16878); // 0.00016878 * 47100 => 7.949538 USD

    await advanceTimeAndBlock(8 * 60 * 60 + 10);

    await expect(
      vault
        .connect(alice)
        .decreasePosition(alice.address, btc.address, btc.address, toUsd(3), 0, true, user.address),
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    const tx1 = await vault
      .connect(alice)
      .decreasePosition(alice.address, btc.address, btc.address, toUsd(1), 0, true, user.address);
    await reportGasUsed(tx1, "withdraw collateral gas used");

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(9.91 - 3 - 1)); // collateral
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(1867); // entryFundingRate
    expect(position[4]).eq((225000 / 90) * 40); // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(toUsd(5)); // pnl
    expect(position[6]).eq(true);

    expect(await vault.getUtilisation(btc.address)).eq(392275); // 100000 / 254923 => ~39.2%

    // funding rate factor => 600 / 1000000 (0.06%)
    // utilisation => ~39.1%
    // funding fee % => 0.02351628%
    // position size => 40 USD
    // funding fee  => 0.0094 USD
    // 0.00000019 BTC => 0.00000019 * 47100 => ~0.009 USD

    expect(await vault.feeReserves(btc.address)).eq(1233);
    expect(await vault.reservedAmounts(btc.address)).eq((225000 / 90) * 40);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(34.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 16878 - 106 - 1 - 2123 - 219); // 0.00002123* 47100 => 1 USD
    expect(await btc.balanceOf(user.address)).eq(18842);

    await validateVaultBalance(vault, btc, 2);
  });
});
