import { DeployFunction } from "hardhat-deploy/types";
import {
  PositionRouter__factory,
  FastPriceFeed__factory,
  FastPriceEvents__factory,
  VaultPriceFeed__factory,
  PriceFeedTimelock__factory,
  TokenManager__factory,
  Vault__factory,
  USDG__factory,
  Router__factory,
} from "../../types";
import { Ship, toUsd, toWei } from "../../utils";
import { TokenData, tokens } from "../../config";
import { TokenManager } from "types";

const depositFee = 30; // 0.3%
const minExecutionFee = "100000000000000"; // 0.0001 ETH

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);

  const { signer, deployer, updater1, updater2, tokenKeeper1, tokenKeeper2 } = accounts;

  const { avax, btc, btcb, eth, mim, usdce, usdc } = tokens.avax;
  const tokenArr = [avax, btc, btcb, eth, mim, usdce, usdc];
  const fastPriceTokens = [avax, btc, btcb, eth];

  let signers: string[];
  let updaters: string[];

  if (hre.network.tags.prod) {
    signers = [];
    updaters = [];
  } else {
    signers = [signer.address];
    updaters = [updater1.address, updater2.address];

    for (const token of tokenArr) {
      const nativeTokenContract = await connect(token.name);
      token.address = nativeTokenContract.address;
    }
  }

  if (fastPriceTokens.find((t) => !t.fastPricePrecision)) {
    throw new Error("Invalid price precision");
  }

  if (fastPriceTokens.find((t) => !t.maxCumulativeDeltaDiff)) {
    throw new Error("Invalid price maxCumulativeDeltaDiff");
  }

  const vault = await connect(Vault__factory);
  const usdg = await connect(USDG__factory);
  const router = await connect(Router__factory);
  const positionRouter = await connect(PositionRouter__factory);
  const priceFeedTimelock = await connect(PriceFeedTimelock__factory);
  const tokenManager = await connect(TokenManager__factory);

  const fastPriceEvents = await deploy(FastPriceEvents__factory);

  const fastPriceFeed = await deploy(FastPriceFeed__factory, {
    args: [
      5 * 60, // _priceDuration
      60 * 60, // _maxPriceUpdateDelay
      1, // _minBlockInterval
      250, // _maxDeviationBasisPoints
      fastPriceEvents.address, // _fastPriceEvents
      deployer.address, // _tokenManager
      positionRouter.address,
    ],
  });

  if (fastPriceFeed.newlyDeployed) {
    await fastPriceFeed.contract.initialize(1, signers, updaters);
    await fastPriceFeed.contract.setTokens(
      fastPriceTokens.map((t) => t.address),
      fastPriceTokens.map((t) => t.fastPricePrecision),
    );
    await fastPriceFeed.contract.setMaxTimeDeviation(60 * 60);
    await fastPriceFeed.contract.setSpreadBasisPointsIfInactive(50);
    await fastPriceFeed.contract.setSpreadBasisPointsIfChainError(500);
    await fastPriceFeed.contract.setMaxCumulativeDeltaDiffs(
      fastPriceTokens.map((t) => t.address),
      fastPriceTokens.map((t) => t.maxCumulativeDeltaDiff),
    );
    await fastPriceFeed.contract.setPriceDataInterval(1 * 60);

    await positionRouter.setPositionKeeper(fastPriceFeed.address, true);
  }
  if (fastPriceEvents.newlyDeployed || fastPriceFeed.newlyDeployed) {
    await fastPriceEvents.contract.setIsPriceFeed(fastPriceFeed.address, true);
  }

  const vaultPriceFeed = await deploy(VaultPriceFeed__factory);
  if (vaultPriceFeed.newlyDeployed) {
    await vaultPriceFeed.contract.setMaxStrictPriceDeviation(toWei(1, 28));
    await vaultPriceFeed.contract.setPriceSampleSpace(1);
    await vaultPriceFeed.contract.setIsAmmEnabled(false);
    await vaultPriceFeed.contract.setGov(priceFeedTimelock.address);
    await fastPriceFeed.contract.setGov(priceFeedTimelock.address);
    await fastPriceFeed.contract.setTokenManager(tokenManager.address);

    for (const tokenItem of tokenArr) {
      const token = tokenItem as TokenData;
      if (token.spreadBasisPoints !== undefined) {
        await vaultPriceFeed.contract.setSpreadBasisPoints(
          tokenItem.address, // _token
          token.spreadBasisPoints, // _spreadBasisPoints
        );
      }
    }

    for (const token of tokenArr) {
      await vaultPriceFeed.contract.setTokenConfig(
        token.address, // _token
        token.priceFeed, // _priceFeed
        token.priceDecimals, // _priceDecimals
        token.isStrictStable, // _isStrictStable
      );
    }

    if (fastPriceFeed.newlyDeployed) {
      await vault.initialize(
        router.address, // router
        usdg.address, // usdg
        vaultPriceFeed.address, // priceFeed
        toUsd(2), // liquidationFeeUsd
        100, // fundingRateFactor
        100, // stableFundingRateFactor
      );
    }
  }

  if (fastPriceFeed.newlyDeployed || vaultPriceFeed.newlyDeployed) {
    await vaultPriceFeed.contract.setSecondaryPriceFeed(fastPriceFeed.address);
    await fastPriceFeed.contract.setVaultPriceFeed(vaultPriceFeed.address);
  }
};

export default func;
func.tags = ["fastPriceFeed", "vaultPriceFeed", "fastPriceEvents"];
func.dependencies = [
  "positionRouter",
  "priceFeedTimelock",
  "tokenManager",
  "tokens",
  "vault",
  "usdg",
  "router",
];
