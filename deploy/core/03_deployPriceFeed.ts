import { DeployFunction } from "hardhat-deploy/types";
import {
  PositionRouter__factory,
  FastPriceFeed__factory,
  FastPriceEvents__factory,
  VaultPriceFeed__factory,
  PriceFeedTimelock__factory,
  Vault__factory,
  USDG__factory,
  Router__factory,
  PriceFeed,
} from "../../types";
import { Ship, toUsd, toWei } from "../../utils";
import { TokenData, tokens, signers as configSigners, updaters as configUpdaters } from "../../config";

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);

  const { signer1, signer2, deployer, updater1, updater2 } = accounts;

  const { avax, btc, btcb, eth, mim, usdce, usdc } = tokens.avax;
  const tokenArr = [avax, btc, btcb, eth, mim, usdce, usdc];
  const fastPriceTokens = [avax, btc, btcb, eth];

  let signers: string[];
  let updaters: string[];

  if (hre.network.tags.prod) {
    signers = configSigners;
    updaters = configUpdaters;
  } else {
    signers = [signer1.address, signer2.address];
    updaters = [updater1.address, updater2.address];

    for (const token of tokenArr) {
      const tokenContract = await connect(token.name);
      const priceFeedContract = (await connect(token.name + "PriceFeed")) as PriceFeed;
      token.address = tokenContract.address;
      token.priceFeed = priceFeedContract.address;
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
  console.log("FastPriceFeed deployed");
  const vaultPriceFeed = await deploy(VaultPriceFeed__factory);
  console.log("VaultPriceFeed deployed");

  if (fastPriceFeed.newlyDeployed || vaultPriceFeed.newlyDeployed) {
    await vaultPriceFeed.contract.setSecondaryPriceFeed(fastPriceFeed.address);
    await fastPriceFeed.contract.setVaultPriceFeed(vaultPriceFeed.address);
  }

  if (fastPriceEvents.newlyDeployed || fastPriceFeed.newlyDeployed) {
    await fastPriceEvents.contract.setIsPriceFeed(fastPriceFeed.address, true);
  }
  if (fastPriceFeed.newlyDeployed) {
    await fastPriceFeed.contract.initialize(signers.length, signers, updaters);
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
    // await fastPriceFeed.contract.setTokenManager(tokenManager.address);

    if (hre.network.tags.live) {
      await fastPriceFeed.contract.setGov(priceFeedTimelock.address);
    }
    console.log("FastPriceFeeed: initialized");
  }

  if (vaultPriceFeed.newlyDeployed) {
    await vaultPriceFeed.contract.setMaxStrictPriceDeviation(toWei(1, 28));
    await vaultPriceFeed.contract.setPriceSampleSpace(3);
    await vaultPriceFeed.contract.setIsAmmEnabled(false);
    await vault.initialize(
      router.address, // router
      usdg.address, // usdg
      vaultPriceFeed.address, // priceFeed
      hre.network.tags.live ? toUsd(2) : toUsd(5), // liquidationFeeUsd
      100, // fundingRateFactor
      100, // stableFundingRateFactor
    );

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

      await vault.setTokenConfig(
        token.address, // _token
        token.decimals, // _tokenDecimals
        token.tokenWeight, // _tokenWeight
        hre.network.tags.live ? token.minProfitBps : 75, // _minProfitBps
        toWei(token.maxUsdgAmount, 30), // _maxUsdgAmount
        token.isStable, // _isStable
        token.isShortable, // _isShortable
      );
    }

    if (hre.network.tags.live) {
      await vaultPriceFeed.contract.setGov(priceFeedTimelock.address);
    }
    console.log("VaultPriceFeeed: initialized");
  }
};

export default func;
func.tags = ["fastPriceFeed", "vaultPriceFeed", "fastPriceEvents"];
func.dependencies = ["positionRouter", "priceFeedTimelock", "tokens", "vault", "usdg", "router"];
