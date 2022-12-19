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
import { Ship, toChainlinkPrice, toUsd } from "../../../utils";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let avax: Token;
let avaxPriceFeed: PriceFeed;
let usdc: Token;
let usdcPriceFeed: PriceFeed;

let xlxManager: XlxManager;

let deployer: SignerWithAddress;
let alice: SignerWithAddress;

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

describe("Vault.getFeeBasisPoints", function () {
  beforeEach(async function () {
    const { accounts } = await setup();

    deployer = accounts.deployer;
    alice = accounts.alice;

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    xlxManager = await ship.connect(XlxManager__factory);

    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    usdcPriceFeed = (await ship.connect("usdcPriceFeed")) as PriceFeed;

    await vault.setFees(
      50, // _taxBasisPoints
      10, // _stableTaxBasisPoints
      20, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      0, // _minProfitTime
      true, // _hasDynamicFees
    );
    await vault.setFundingRate(60 * 60, 600, 600);

    await xlxManager.setCooldownDuration(24 * 60 * 60);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    await xlxManager.setInPrivateMode(false);
    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);

    await vault.setInManagerMode(false);
  });

  it("getFeeBasisPoints", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    expect(await vault.getTargetUsdgAmount(avax.address)).eq(0);

    await avax.mint(vault.address, 100);
    await vault.connect(alice).buyUSDG(avax.address, deployer.address);

    expect(await vault.usdgAmounts(avax.address)).eq(29700);
    expect(await vault.getTargetUsdgAmount(avax.address)).eq(2078); // 2078 = 1970 * avaxWeight / totalWeight

    // usdgAmount(avax) is 29700, targetAmount(avax) is 29700
    expect(await vault.getFeeBasisPoints(avax.address, 1000, 100, 50, true)).eq(150);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 100, 50, true)).eq(150);
    expect(await vault.getFeeBasisPoints(avax.address, 1000, 100, 50, false)).eq(0);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 100, 50, false)).eq(0);

    expect(await vault.getFeeBasisPoints(avax.address, 1000, 50, 100, true)).eq(150);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 50, 100, true)).eq(150);
    expect(await vault.getFeeBasisPoints(avax.address, 1000, 50, 100, false)).eq(0);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 50, 100, false)).eq(0);

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    expect(await vault.getTargetUsdgAmount(avax.address)).eq(2078);
    expect(await vault.getTargetUsdgAmount(usdc.address)).eq(13958);

    // usdgAmount(avax) is 29700, targetAmount(avax) is 14850
    // incrementing avax has an increased fee, while reducing avax has a decreased fee
    expect(await vault.getFeeBasisPoints(avax.address, 1000, 100, 50, true)).eq(150);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 100, 50, true)).eq(150);
    expect(await vault.getFeeBasisPoints(avax.address, 10000, 100, 50, true)).eq(150);
    expect(await vault.getFeeBasisPoints(avax.address, 20000, 100, 50, true)).eq(150);
    expect(await vault.getFeeBasisPoints(avax.address, 1000, 100, 50, false)).eq(0);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 100, 50, false)).eq(0);
    expect(await vault.getFeeBasisPoints(avax.address, 10000, 100, 50, false)).eq(0);
    expect(await vault.getFeeBasisPoints(avax.address, 20000, 100, 50, false)).eq(0);
    expect(await vault.getFeeBasisPoints(avax.address, 25000, 100, 50, false)).eq(0);
    expect(await vault.getFeeBasisPoints(avax.address, 100000, 100, 50, false)).eq(0);

    await usdc.mint(vault.address, 20000);
    await vault.connect(alice).buyUSDG(usdc.address, deployer.address);

    expect(await vault.getTargetUsdgAmount(avax.address)).eq("1390186098141097");
    expect(await vault.getTargetUsdgAmount(usdc.address)).eq("9334106658947369");

    const avaxConfig: [string, number, number, number, number, boolean, boolean] = [
      avax.address, // _token
      18, // _tokenDecimals
      30000, // _tokenWeight
      75, // _minProfitBps,
      0, // _maxUsdgAmount
      false, // _isStable
      true, // _isShortable
    ];
    await vault.setTokenConfig(...avaxConfig);

    expect(await vault.getTargetUsdgAmount(avax.address)).eq("4843863058031162"); // increased by token weight
    expect(await vault.getTargetUsdgAmount(usdc.address)).eq("7588718790915487"); // decreased

    expect(await vault.usdgAmounts(avax.address)).eq(29700);

    // usdgAmount(avax) is 29700, targetAmount(avax) is 37270
    // incrementing avax has a decreased fee, while reducing avax has an increased fee
    expect(await vault.getFeeBasisPoints(avax.address, 1000, 100, 50, true)).eq(51);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 100, 50, true)).eq(51);
    expect(await vault.getFeeBasisPoints(avax.address, 10000, 100, 50, true)).eq(51);
    expect(await vault.getFeeBasisPoints(avax.address, 1000, 100, 50, false)).eq(149);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 100, 50, false)).eq(149);
    expect(await vault.getFeeBasisPoints(avax.address, 10000, 100, 50, false)).eq(149);

    avaxConfig[2] = 5000;
    await vault.setTokenConfig(...avaxConfig);

    await avax.mint(vault.address, 200);
    await vault.connect(alice).buyUSDG(avax.address, deployer.address);

    expect(await vault.usdgAmounts(avax.address)).eq(89700);
    expect(await vault.getTargetUsdgAmount(avax.address)).eq("1013254966790629"); // decreased
    expect(await vault.getTargetUsdgAmount(usdc.address)).eq("9524596687831919"); // increased

    // usdgAmount(avax) is 88800, targetAmount(avax) is 36266
    // incrementing avax has an increased fee, while reducing avax has a decreased fee
    expect(await vault.getFeeBasisPoints(avax.address, 1000, 100, 50, true)).eq(51);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 100, 50, true)).eq(51);
    expect(await vault.getFeeBasisPoints(avax.address, 10000, 100, 50, true)).eq(51);
    expect(await vault.getFeeBasisPoints(avax.address, 1000, 100, 50, false)).eq(149);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 100, 50, false)).eq(149);
    expect(await vault.getFeeBasisPoints(avax.address, 20000, 100, 50, false)).eq(149);
    expect(await vault.getFeeBasisPoints(avax.address, 50000, 100, 50, false)).eq(149);
    expect(await vault.getFeeBasisPoints(avax.address, 80000, 100, 50, false)).eq(149);

    expect(await vault.getFeeBasisPoints(avax.address, 1000, 50, 100, true)).eq(0);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 50, 100, true)).eq(0);
    expect(await vault.getFeeBasisPoints(avax.address, 10000, 50, 100, true)).eq(0);
    expect(await vault.getFeeBasisPoints(avax.address, 1000, 50, 100, false)).eq(149);
    expect(await vault.getFeeBasisPoints(avax.address, 5000, 50, 100, false)).eq(149);
    expect(await vault.getFeeBasisPoints(avax.address, 20000, 50, 100, false)).eq(149);
    expect(await vault.getFeeBasisPoints(avax.address, 50000, 50, 100, false)).eq(149);
  });
});
