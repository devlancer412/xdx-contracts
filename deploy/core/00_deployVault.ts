import { DeployFunction } from "hardhat-deploy/types";
import {
  Router__factory,
  ShortsTracker__factory,
  Token__factory,
  USDG__factory,
  VaultErrorController__factory,
  VaultPriceFeed__factory,
  VaultUtils__factory,
  Vault__factory,
  XlxManager__factory,
  XLX__factory,
} from "../../types";
import { Ship, toUsd, toWei } from "../../utils";
import { tokens, errors, NativeToken } from "../../config";

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);

  const { deployer } = accounts;

  const nativeToken = tokens.avax.nativeToken as NativeToken;

  if (!hre.network.tags.prod) {
    const nativeTokenContract = await connect(nativeToken.name);

    nativeToken.address = nativeTokenContract.address;
  }

  const vault = await deploy(Vault__factory);
  const usdg = await deploy(USDG__factory, {
    args: [vault.address],
  });
  await deploy(Router__factory, {
    args: [vault.address, usdg.address, nativeToken.address],
  });

  const xlx = await deploy(XLX__factory);
  if (xlx.newlyDeployed) {
    await xlx.contract.setInPrivateTransferMode(true);
  }

  const shortsTracker = await deploy(ShortsTracker__factory, {
    args: [vault.address],
  });
  if (shortsTracker.newlyDeployed) {
    await shortsTracker.contract.setGov(deployer.address);
  }

  const xlxManager = await deploy(XlxManager__factory, {
    args: [vault.address, usdg.address, xlx.address, shortsTracker.address, "900"], // 900 = 60 * 15
  });
  if (xlxManager.newlyDeployed) {
    await xlxManager.contract.setInPrivateMode(true);
  }
  if (xlxManager.newlyDeployed || xlx.newlyDeployed) {
    await xlx.contract.setMinter(xlxManager.address, true);
  }
  if (xlxManager.newlyDeployed || usdg.newlyDeployed) {
    await usdg.contract.addVault(xlxManager.address);
  }

  if (vault.newlyDeployed) {
    await vault.contract.setFundingRate(60 * 60, 100, 100);
    await vault.contract.setInManagerMode(true);
    await vault.contract.setFees(
      10, // _taxBasisPoints
      5, // _stableTaxBasisPoints
      20, // _mintBurnFeeBasisPoints
      20, // _swapFeeBasisPoints
      1, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(2), // _liquidationFeeUsd
      24 * 60 * 60, // _minProfitTime
      true, // _hasDynamicFees
    );
  }

  if (vault.newlyDeployed || xlxManager.newlyDeployed) {
    await vault.contract.setManager(xlxManager.address, true);
  }

  const vaultErrorController = await deploy(VaultErrorController__factory);
  if (vaultErrorController.newlyDeployed || vault.newlyDeployed) {
    await vault.contract.setErrorController(vaultErrorController.address);
    await vaultErrorController.contract.setErrors(vault.address, errors);
  }

  const vaultUtils = await deploy(VaultUtils__factory, {
    args: [vault.address],
  });
  if (vault.newlyDeployed || vaultUtils.newlyDeployed) {
    await vault.contract.setVaultUtils(vaultUtils.address);
  }
};

export default func;
func.tags = [
  "vault",
  "usdg",
  "router",
  "xlx",
  "shortsTracker",
  "xlxManager",
  "vaultErrorController",
  "vaultUtils",
  "nativeToken",
];
func.dependencies = ["tokens"];
