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
  PancakePair__factory,
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
let avax: Token;
let avaxPriceFeed: PriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let usdc: Token;
let usdcPriceFeed: PriceFeed;
let usdcePriceFeed: PriceFeed;
let eth: Token;

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

describe("Vault.getPrice", function () {
  beforeEach(async function () {
    const { accounts } = await setup();

    deployer = accounts.deployer;
    alice = accounts.alice;

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    xlxManager = await ship.connect(XlxManager__factory);

    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;
    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    usdcPriceFeed = (await ship.connect("usdcPriceFeed")) as PriceFeed;
    usdcePriceFeed = (await ship.connect("usdcePriceFeed")) as PriceFeed;
    eth = (await ship.connect("eth")) as Token;

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
    await vaultPriceFeed.setPriceSampleSpace(3);
  });

  it("getPrice", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(toWei(1, 30));

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1.1));
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(toWei(11, 29));

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await vault.setTokenConfig(
      usdc.address, // _token
      18, // _tokenDecimals
      10000, // _tokenWeight
      75, // _minProfitBps,
      0, // _maxUsdgAmount
      false, // _isStable
      true, // _isShortable
    );

    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(toWei(1.1, 30));
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1.1));
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(toWei(11, 29));

    await vaultPriceFeed.setMaxStrictPriceDeviation(toWei(1, 29));
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(toWei(1, 30));

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1.11));
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(toWei(111, 28));
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(toWei(1, 30));

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(0.9));
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(toWei(111, 28));
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(toWei(1, 30));

    await vaultPriceFeed.setSpreadBasisPoints(usdc.address, 20);
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(toWei(1, 30));

    await vaultPriceFeed.setSpreadBasisPoints(usdc.address, 0);
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(0.89));
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(0.89));
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(toWei(1, 30));
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(toWei(89, 28));

    await vaultPriceFeed.setSpreadBasisPoints(usdc.address, 20);
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(toWei(89, 28));

    await vaultPriceFeed.setUseV2Pricing(true);
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(toWei(89, 28));

    await vaultPriceFeed.setSpreadBasisPoints(btc.address, 0);
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    expect(await vaultPriceFeed.getPrice(btc.address, true, true, true)).eq(toWei(60000, 30));

    await vaultPriceFeed.setSpreadBasisPoints(btc.address, 20);
    expect(await vaultPriceFeed.getPrice(btc.address, false, true, true)).eq(toWei(39920, 30));
  });

  it("includes AMM price", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(600));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(80000));
    await usdcePriceFeed.setLatestAnswer(toChainlinkPrice(1));

    const avaxUsdce = (await ship.deploy(PancakePair__factory)).contract;
    await avaxUsdce.setReserves(toWei(1000, 18), toWei(300 * 1000, 6));

    const ethAvax = (await ship.deploy(PancakePair__factory)).contract;
    await ethAvax.setReserves(toWei(800, 18), toWei(100, 18));

    const btcavax = (await ship.deploy(PancakePair__factory)).contract;
    await btcavax.setReserves(toWei(10, 18), toWei(2000, 18));

    await vaultPriceFeed.setTokens(btc.address, eth.address, avax.address);
    await vaultPriceFeed.setPairs(avaxUsdce.address, ethAvax.address, btcavax.address);

    await vaultPriceFeed.setIsAmmEnabled(false);

    expect(await vaultPriceFeed.getPrice(avax.address, false, true, true)).eq(toUsd(300));
    expect(await vaultPriceFeed.getPrice(btc.address, false, true, true)).eq(toUsd(60000));

    await vaultPriceFeed.setIsAmmEnabled(true);

    expect(await vaultPriceFeed.getPrice(avax.address, false, true, true)).eq(toUsd(200));
    expect(await vaultPriceFeed.getPrice(btc.address, false, true, true)).eq(toUsd(40000));

    await vaultPriceFeed.setIsAmmEnabled(false);

    expect(await vaultPriceFeed.getPrice(avax.address, false, true, true)).eq(toUsd(300));
    expect(await vaultPriceFeed.getPrice(btc.address, false, true, true)).eq(toUsd(60000));

    await vaultPriceFeed.setIsAmmEnabled(true);

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(200));
    expect(await vaultPriceFeed.getPrice(avax.address, false, true, true)).eq(toUsd(200));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    expect(await vaultPriceFeed.getPrice(btc.address, false, true, true)).eq(toUsd(40000));

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(250));
    expect(await vaultPriceFeed.getPrice(avax.address, false, true, true)).eq(toUsd(200));

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(280));
    expect(await vaultPriceFeed.getPrice(avax.address, true, true, true)).eq(toUsd(280));

    await vaultPriceFeed.setSpreadBasisPoints(avax.address, 20);
    expect(await vaultPriceFeed.getPrice(avax.address, false, true, true)).eq(toUsd(199.6));
    expect(await vaultPriceFeed.getPrice(avax.address, true, true, true)).eq(toUsd(280.56));

    await vaultPriceFeed.setUseV2Pricing(true);
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(301));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(302));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(303));

    expect(await vaultPriceFeed.getPrice(avax.address, false, true, true)).eq(toUsd(199.6));
    expect(await vaultPriceFeed.getPrice(avax.address, true, true, true)).eq(toUsd(303.606));

    await vaultPriceFeed.setSpreadThresholdBasisPoints(90);

    expect(await vaultPriceFeed.getPrice(avax.address, false, true, true)).eq(toUsd(199.6));
    expect(await vaultPriceFeed.getPrice(avax.address, true, true, true)).eq(toUsd(303.606));

    await vaultPriceFeed.setSpreadThresholdBasisPoints(100);

    expect(await vaultPriceFeed.getPrice(avax.address, false, true, true)).eq(toUsd(199.6));
    expect(await vaultPriceFeed.getPrice(avax.address, true, true, true)).eq(toUsd(303.606));

    await vaultPriceFeed.setFavorPrimaryPrice(true);

    expect(await vaultPriceFeed.getPrice(avax.address, false, true, true)).eq(toUsd(199.6));
    expect(await vaultPriceFeed.getPrice(avax.address, true, true, true)).eq(toUsd(303.606));
  });
});
