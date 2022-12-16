import { DeployFunction } from "hardhat-deploy/types";
import {
  BonusDistributor__factory,
  EsXDX__factory,
  RewardDistributor__factory,
  RewardRouterV2__factory,
  RewardTracker__factory,
  Vester__factory,
  XDX__factory,
  XlxManager__factory,
  XLX__factory,
} from "../../types";
import { Ship } from "../../utils";
import { NativeToken, tokens } from "../../config";

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);

  const nativeToken = tokens.avax.nativeToken as NativeToken;

  if (!hre.network.tags.prod) {
    const nativeTokenContract = await connect(nativeToken.name);

    nativeToken.address = nativeTokenContract.address;
  }

  const vestingDuration = 365 * 24 * 60 * 60;

  const xlxManager = await connect(XlxManager__factory);
  const xlx = await connect(XLX__factory);
  const xdx = await connect(XDX__factory);
  const esXdx = await connect(EsXDX__factory);
  const bnXdx = await connect("BN_XDX");

  const stakedXdxTracker = await deploy(RewardTracker__factory, {
    aliasName: "StakedXdxTracker",
    args: ["Staked XDX", "sXDX"],
  });
  const stakedXdxDistributor = await deploy(RewardDistributor__factory, {
    aliasName: "StakedXdxDistributor",
    args: [esXdx.address, stakedXdxTracker.address],
  });
  if (stakedXdxTracker.newlyDeployed) {
    await stakedXdxTracker.contract.setInPrivateTransferMode(true);
    await stakedXdxTracker.contract.setInPrivateStakingMode(true);
    // allow stakedXdxTracker to stake esXdx
    await esXdx.setHandler(stakedXdxTracker.address, true);
  }
  if (stakedXdxDistributor.newlyDeployed) {
    await esXdx.setHandler(stakedXdxDistributor.address, true);
  }
  if (stakedXdxTracker.newlyDeployed || stakedXdxDistributor.newlyDeployed) {
    await stakedXdxTracker.contract.initialize([xdx.address, esXdx.address], stakedXdxDistributor.address);
    await stakedXdxDistributor.contract.updateLastDistributionTime();
  }

  const bonusXdxTracker = await deploy(RewardTracker__factory, {
    aliasName: "BonusXdxTracker",
    args: ["Staked + Bonus XDX", "sbXDX"],
  });
  const bonusXdxDistributor = await deploy(BonusDistributor__factory, {
    aliasName: "BonusXdxDistributor",
    args: [bnXdx.address, bonusXdxTracker.address],
  });
  if (bonusXdxTracker.newlyDeployed) {
    await bonusXdxTracker.contract.setInPrivateTransferMode(true);
    await bonusXdxTracker.contract.setInPrivateStakingMode(true);
  }
  if (bonusXdxDistributor.newlyDeployed) {
    await bonusXdxDistributor.contract.setBonusMultiplier(10000);
  }
  if (bonusXdxTracker.newlyDeployed || bonusXdxDistributor.newlyDeployed) {
    await bonusXdxTracker.contract.initialize([stakedXdxTracker.address], bonusXdxDistributor.address);
    await bonusXdxDistributor.contract.updateLastDistributionTime();
  }

  const feeXdxTracker = await deploy(RewardTracker__factory, {
    aliasName: "FeeXdxTracker",
    args: ["Staked + Bonus + Fee XDX", "sbfXDX"],
  });
  const feeXdxDistributor = await deploy(RewardDistributor__factory, {
    aliasName: "FeeXdxDistributor",
    args: [nativeToken.address, feeXdxTracker.address],
  });
  if (feeXdxTracker.newlyDeployed) {
    await feeXdxTracker.contract.setInPrivateTransferMode(true);
    await feeXdxTracker.contract.setInPrivateStakingMode(true);
    // allow feeXdxTracker to stake bnXdx
    await bnXdx.setHandler(feeXdxTracker.address, true);
  }
  if (feeXdxTracker.newlyDeployed || feeXdxDistributor.newlyDeployed) {
    await feeXdxTracker.contract.initialize(
      [bonusXdxTracker.address, bnXdx.address],
      feeXdxDistributor.address,
    );
    await feeXdxDistributor.contract.updateLastDistributionTime();
  }

  const feeXlxTracker = await deploy(RewardTracker__factory, {
    aliasName: "FeeXlxTracker",
    args: ["Fee XLX", "fXLX"],
  });
  const feeXlxDistributor = await deploy(RewardDistributor__factory, {
    aliasName: "FeeXlxDistributor",
    args: [nativeToken.address, feeXlxTracker.address],
  });
  if (feeXlxTracker.newlyDeployed) {
    await feeXlxTracker.contract.setInPrivateTransferMode(true);
    await feeXlxTracker.contract.setInPrivateStakingMode(true);
    // allow feeXlxTracker to stake xlx
    await xlx.setHandler(feeXlxTracker.address, true);
  }
  if (feeXlxTracker.newlyDeployed || feeXlxDistributor.newlyDeployed) {
    await feeXlxTracker.contract.initialize([xlx.address], feeXlxDistributor.address);
    await feeXlxDistributor.contract.updateLastDistributionTime();
  }

  const stakedXlxTracker = await deploy(RewardTracker__factory, {
    aliasName: "StakedXlxTracker",
    args: ["Fee + Staked XLX", "fsXLX"],
  });
  const stakedXlxDistributor = await deploy(RewardDistributor__factory, {
    aliasName: "StakedXlxDistributor",
    args: [esXdx.address, stakedXlxTracker.address],
  });
  if (stakedXlxTracker.newlyDeployed) {
    await stakedXlxTracker.contract.setInPrivateTransferMode(true);
    await stakedXlxTracker.contract.setInPrivateStakingMode(true);
    esXdx.setHandler(stakedXlxTracker.address, true);
  }
  if (stakedXlxDistributor.newlyDeployed) {
    await esXdx.setHandler(stakedXlxDistributor.address, true);
  }
  if (stakedXlxTracker.newlyDeployed || stakedXlxDistributor.newlyDeployed) {
    await stakedXlxTracker.contract.initialize([feeXlxTracker.address], stakedXlxDistributor.address);
    await stakedXlxDistributor.contract.updateLastDistributionTime();
  }

  const xdxVester = await deploy(Vester__factory, {
    aliasName: "XdxVester",
    args: [
      "Vested XDX", // _name
      "vXDX", // _symbol
      vestingDuration, // _vestingDuration
      esXdx.address, // _esToken
      feeXdxTracker.address, // _pairToken
      xdx.address, // _claimableToken
      stakedXdxTracker.address, // _rewardTracker
    ],
  });
  if (xdxVester.newlyDeployed) {
    await esXdx.setHandler(xdxVester.address, true);
    await esXdx.setMinter(xdxVester.address, true);
  }

  const xlxVester = await deploy(Vester__factory, {
    aliasName: "XlxVester",
    args: [
      "Vested XLX", // _name
      "vXLX", // _symbol
      vestingDuration, // _vestingDuration
      esXdx.address, // _esToken
      feeXlxTracker.address, // _pairToken
      xdx.address, // _claimableToken
      stakedXlxTracker.address, // _rewardTracker
    ],
  });
  if (xlxVester.newlyDeployed) {
    await esXdx.setHandler(xlxVester.address, true);
    await esXdx.setMinter(xlxVester.address, true);
  }

  const rewardRouter = await deploy(RewardRouterV2__factory);
  if (rewardRouter.newlyDeployed) {
    await rewardRouter.contract.initialize(
      nativeToken.address,
      xdx.address,
      esXdx.address,
      bnXdx.address,
      xlx.address,
      stakedXdxTracker.address,
      bonusXdxTracker.address,
      feeXdxTracker.address,
      feeXlxTracker.address,
      stakedXlxTracker.address,
      xlxManager.address,
      xdxVester.address,
      xlxVester.address,
    );
  }
  if (rewardRouter.newlyDeployed) {
    // allow rewardRouter to burn bnXdx
    await bnXdx.setMinter(rewardRouter.address, true);
    await esXdx.setHandler(rewardRouter.address, true);
  }

  if (stakedXdxTracker.newlyDeployed || rewardRouter.newlyDeployed) {
    // allow rewardRouter to stake in stakedXdxTracker
    await stakedXdxTracker.contract.setHandler(rewardRouter.address, true);
  }

  if (stakedXdxTracker.newlyDeployed || bonusXdxTracker.newlyDeployed) {
    // allow bonusXdxTracker to stake stakedXdxTracker
    await stakedXdxTracker.contract.setHandler(bonusXdxTracker.address, true);
  }

  if (bonusXdxTracker.newlyDeployed || rewardRouter.newlyDeployed) {
    // allow rewardRouter to stake in bonusXdxTracker
    await bonusXdxTracker.contract.setHandler(rewardRouter.address, true);
  }

  if (bonusXdxTracker.newlyDeployed || feeXdxTracker.newlyDeployed) {
    // allow bonusXdxTracker to stake feeXdxTracker
    await bonusXdxTracker.contract.setHandler(feeXdxTracker.address, true);
  }

  if (feeXdxTracker.newlyDeployed || rewardRouter.newlyDeployed) {
    // allow rewardRouter to stake in feeXdxTracker
    await feeXdxTracker.contract.setHandler(rewardRouter.address, true);
  }

  if (feeXlxTracker.newlyDeployed || stakedXlxTracker.newlyDeployed) {
    // allow stakedXlxTracker to stake feeXlxTracker
    await feeXlxTracker.contract.setHandler(stakedXlxTracker.address, true);
  }

  if (feeXlxTracker.newlyDeployed || rewardRouter.newlyDeployed) {
    // allow rewardRouter to stake in feeXlxTracker
    await feeXlxTracker.contract.setHandler(rewardRouter.address, true);
  }

  if (stakedXlxTracker.newlyDeployed || rewardRouter.newlyDeployed) {
    // allow rewardRouter to stake in stakedXlxTracker
    await stakedXlxTracker.contract.setHandler(rewardRouter.address, true);
  }

  if (xdxVester.newlyDeployed || rewardRouter.newlyDeployed) {
    await xdxVester.contract.setHandler(rewardRouter.address, true);
  }

  if (xlxVester.newlyDeployed || rewardRouter.newlyDeployed) {
    await xlxVester.contract.setHandler(rewardRouter.address, true);
  }

  if (feeXdxTracker.newlyDeployed || xdxVester.newlyDeployed) {
    await feeXdxTracker.contract.setHandler(xdxVester.address, true);
  }

  if (stakedXlxTracker.newlyDeployed || xlxVester.newlyDeployed) {
    await stakedXlxTracker.contract.setHandler(xlxVester.address, true);
  }
};

export default func;
func.tags = [
  "stakedXdxTracker",
  "stakedXdxDistributor",
  "bonusXdxTracker",
  "bonusXdxDistributor",
  "feeXdxTracker",
  "feeXdxDistributor",
  "feeXlxTracker",
  "feeXlxDistributor",
  "stakedXlxTracker",
  "stakedXlxDistributor",
  "xdxVester",
  "xlxVester",
  "rewardRouter",
];
func.dependencies = ["tokens", "xlxManager", "xlx", "xdx", "esXdx", "bnXdx"];
