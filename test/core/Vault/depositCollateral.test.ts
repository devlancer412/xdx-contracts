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
import { reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";
import { validateVaultBalance } from "./shared";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;

let xlxManager: XlxManager;

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

describe("Vault.depositCollateral", function () {
  beforeEach(async function () {
    const { accounts } = await setup();

    alice = accounts.alice;
    bob = accounts.bob;

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    xlxManager = await ship.connect(XlxManager__factory);

    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;

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

  it("deposit collateral", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    await btc.mint(alice.address, toWei(1, 8));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.connect(alice).transfer(vault.address, 117500 - 1); // 0.001174 BTC => 47

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(47), true),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    expect(await vault.feeReserves(btc.address)).eq(0);
    expect(await vault.usdgAmounts(btc.address)).eq(0);
    expect(await vault.poolAmounts(btc.address)).eq(0);

    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(0);
    await vault.buyUSDG(btc.address, bob.address);
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(46.8584));

    expect(await vault.feeReserves(btc.address)).eq(353); // (117500 - 1) * 0.3% => 353
    expect(await vault.usdgAmounts(btc.address)).eq("46858400000000000000"); // (117500 - 1 - 353) * 40000
    expect(await vault.poolAmounts(btc.address)).eq(117500 - 1 - 353);

    await btc.connect(alice).transfer(vault.address, 117500 - 1);
    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(100), true),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault.buyUSDG(btc.address, bob.address);

    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(93.7168));

    expect(await vault.feeReserves(btc.address)).eq(353 * 2); // (117500 - 1) * 0.3% * 2
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2);

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(47), true),
    ).to.be.revertedWith("Vault: insufficient collateral for fees");

    await btc.connect(alice).transfer(vault.address, 22500);

    expect(await vault.reservedAmounts(btc.address)).eq(0);
    expect(await vault.guaranteedUsd(btc.address)).eq(0);

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount

    expect(await xlxManager.getAumInUsdg(false)).eq("93716800000000000000"); // 93.7168
    expect(await xlxManager.getAumInUsdg(true)).eq("96059720000000000000"); // 96.05972

    const tx0 = await vault
      .connect(alice)
      .increasePosition(alice.address, btc.address, btc.address, toUsd(47), true);
    await reportGasUsed(tx0, "increasePosition gas used");

    expect(await xlxManager.getAumInUsdg(false)).eq("93718200000000000000"); // 93.7182
    expect(await xlxManager.getAumInUsdg(true)).eq("95109980000000000000"); // 95.10998

    expect(await vault.poolAmounts(btc.address)).eq(256792 - 114);
    expect(await vault.reservedAmounts(btc.address)).eq(117500);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(38.047));
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(92.79)); // (256792 - 117500) sats * 40000 => 51.7968, 47 / 40000 * 41000 => ~45.8536

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(47)); // size
    expect(position[1]).eq(toUsd(8.953)); // collateral, 0.000225 BTC => 9, 9 - 0.047 => 8.953
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(117500); // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(353 * 2 + 114); // fee is 0.047 USD => 0.00000114 BTC
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2 + 22500 - 114);

    let leverage = await vault.getPositionLeverage(alice.address, btc.address, btc.address, true);
    expect(leverage).eq(52496); // ~5.2x

    await btc.connect(alice).transfer(vault.address, 22500);

    expect(await xlxManager.getAumInUsdg(false)).eq("93718200000000000000"); // 93.7182
    expect(await xlxManager.getAumInUsdg(true)).eq("95109980000000000000"); // 95.10998

    const tx1 = await vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, 0, true);
    await reportGasUsed(tx1, "deposit collateral gas used");

    expect(await xlxManager.getAumInUsdg(false)).eq("93718200000000000000"); // 93.7182
    expect(await xlxManager.getAumInUsdg(true)).eq("95334980000000000000"); // 95.33498

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(47)); // size
    expect(position[1]).eq(toUsd(8.953 + 9)); // collateral
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(117500); // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(353 * 2 + 114); // fee is 0.047 USD => 0.00000114 BTC
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2 + 22500 + 22500 - 114);

    leverage = await vault.getPositionLeverage(alice.address, btc.address, btc.address, true);
    expect(leverage).eq(26179); // ~2.6x

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(51000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    expect(await xlxManager.getAumInUsdg(false)).eq("109886000000000000000"); // 109.886
    expect(await xlxManager.getAumInUsdg(true)).eq("111502780000000000000"); // 111.50278

    await btc.connect(alice).transfer(vault.address, 100);
    await vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, 0, true);

    expect(await xlxManager.getAumInUsdg(false)).eq("109886000000000000000"); // 109.886
    expect(await xlxManager.getAumInUsdg(true)).eq("111503780000000000000"); // 111.50378

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(47)); // size
    expect(position[1]).eq(toUsd(8.953 + 9 + 0.05)); // collateral
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(117500); // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(353 * 2 + 114); // fee is 0.047 USD => 0.00000114 BTC
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2 + 22500 + 22500 + 100 - 114);

    leverage = await vault.getPositionLeverage(alice.address, btc.address, btc.address, true);
    expect(leverage).eq(26106); // ~2.6x

    await validateVaultBalance(vault, btc);
  });
});
