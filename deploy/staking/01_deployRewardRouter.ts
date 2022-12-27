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

  const nativeToken = tokens[hre.network.name as "avax" | "avax_test"].nativeToken as NativeToken;

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
  if (stakedXdxTracker.newlyDeployed || stakedXdxDistributor.newlyDeployed) {
    const tx = await stakedXdxTracker.contract.initialize(
      [xdx.address, esXdx.address],
      stakedXdxDistributor.address,
    );
    console.log("Initialize StakedXdxTracker at ", tx.hash);
    await tx.wait();
  }
  if (stakedXdxTracker.newlyDeployed) {
    let tx = await stakedXdxTracker.contract.setInPrivateTransferMode(true);
    console.log("Set InPrivatePrivateTransferMode StakedXdxTracker at ", tx.hash);
    await tx.wait();
    tx = await stakedXdxTracker.contract.setInPrivateStakingMode(true);
    console.log("Set private staking mode StakedXdxTracker at ", tx.hash);
    await tx.wait();
    // allow stakedXdxTracker to stake esXdx
    tx = await esXdx.setHandler(stakedXdxTracker.address, true);
    console.log("Set StakedXdxTracker to handler of EsXdx at ", tx.hash);
    await tx.wait();
  }
  if (stakedXdxDistributor.newlyDeployed) {
    let tx = await stakedXdxDistributor.contract.updateLastDistributionTime();
    console.log("Update last distribution time at ", tx.hash);
    await tx.wait();
    tx = await esXdx.setHandler(stakedXdxDistributor.address, true);
    console.log("Set StakedXdxDistributor to handler of EsXdx at ", tx.hash);
    await tx.wait();
  }

  const bonusXdxTracker = await deploy(RewardTracker__factory, {
    aliasName: "BonusXdxTracker",
    args: ["Staked + Bonus XDX", "sbXDX"],
  });
  const bonusXdxDistributor = await deploy(BonusDistributor__factory, {
    aliasName: "BonusXdxDistributor",
    args: [bnXdx.address, bonusXdxTracker.address],
  });
  if (bonusXdxTracker.newlyDeployed || bonusXdxDistributor.newlyDeployed) {
    const tx = await bonusXdxTracker.contract.initialize(
      [stakedXdxTracker.address],
      bonusXdxDistributor.address,
    );
    console.log("Initialize BonusXdxTracker at ", tx.hash);
    await tx.wait();
  }
  if (bonusXdxTracker.newlyDeployed) {
    let tx = await bonusXdxTracker.contract.setInPrivateTransferMode(true);
    console.log("Set private transfer mode to BonusXdxTracker at ", tx.hash);
    await tx.wait();
    tx = await bonusXdxTracker.contract.setInPrivateStakingMode(true);
    console.log("Set private staking mode to BonusXdxTracker at ", tx.hash);
    await tx.wait();
  }
  if (bonusXdxDistributor.newlyDeployed) {
    let tx = await bonusXdxDistributor.contract.updateLastDistributionTime();
    console.log("Update last distribution time of BonusXdxDistributor at ", tx.hash);
    await tx.wait();
    tx = await bonusXdxDistributor.contract.setBonusMultiplier(10000);
    console.log("Set BonusMultiplier of BonusXdxDistributor at ", tx.hash);
    await tx.wait();
  }

  const feeXdxTracker = await deploy(RewardTracker__factory, {
    aliasName: "FeeXdxTracker",
    args: ["Staked + Bonus + Fee XDX", "sbfXDX"],
  });
  const feeXdxDistributor = await deploy(RewardDistributor__factory, {
    aliasName: "FeeXdxDistributor",
    args: [nativeToken.address, feeXdxTracker.address],
  });
  if (feeXdxTracker.newlyDeployed || feeXdxDistributor.newlyDeployed) {
    const tx = await feeXdxTracker.contract.initialize(
      [bonusXdxTracker.address, bnXdx.address],
      feeXdxDistributor.address,
    );
    console.log("Initialize FeeXdxTracker at ", tx.hash);
    await tx.wait();
  }
  if (feeXdxTracker.newlyDeployed) {
    let tx = await feeXdxTracker.contract.setInPrivateTransferMode(true);
    console.log("Set private transfer mode to FeeXdxTracker at ", tx.hash);
    await tx.wait();
    tx = await feeXdxTracker.contract.setInPrivateStakingMode(true);
    console.log("Set private staking mode to FeeXdxTracker at ", tx.hash);
    await tx.wait();
    // allow feeXdxTracker to stake bnXdx
    tx = await bnXdx.setHandler(feeXdxTracker.address, true);
    console.log("Set FeeXdxTracker to handler of BnXdx at ", tx.hash);
    await tx.wait();
  }
  if (feeXdxDistributor.newlyDeployed) {
    const tx = await feeXdxDistributor.contract.updateLastDistributionTime();
    console.log("Update last distribution time of FeeXdxDistributor at ", tx.hash);
    await tx.wait();
  }

  const feeXlxTracker = await deploy(RewardTracker__factory, {
    aliasName: "FeeXlxTracker",
    args: ["Fee XLX", "fXLX"],
  });
  const feeXlxDistributor = await deploy(RewardDistributor__factory, {
    aliasName: "FeeXlxDistributor",
    args: [nativeToken.address, feeXlxTracker.address],
  });
  if (feeXlxTracker.newlyDeployed || feeXlxDistributor.newlyDeployed) {
    const tx = await feeXlxTracker.contract.initialize([xlx.address], feeXlxDistributor.address);
    console.log("Initialize FeeXlxTracker at ", tx.hash);
    await tx.wait();
  }
  if (feeXlxTracker.newlyDeployed) {
    let tx = await feeXlxTracker.contract.setInPrivateTransferMode(true);
    console.log("Set private transfer mode to FeeXlxTracker at ", tx.hash);
    await tx.wait();
    tx = await feeXlxTracker.contract.setInPrivateStakingMode(true);
    console.log("Set private staking mode to FeeXlxTracker at ", tx.hash);
    await tx.wait();
    // allow feeXlxTracker to stake xlx
    tx = await xlx.setHandler(feeXlxTracker.address, true);
    console.log("Set FeeXlxTracker to handler of Xlx at ", tx.hash);
    await tx.wait();
  }
  if (feeXlxDistributor.newlyDeployed) {
    const tx = await feeXlxDistributor.contract.updateLastDistributionTime();
    console.log("Update last distribution time of FeeXlxDistributor at ", tx.hash);
    await tx.wait();
  }

  const stakedXlxTracker = await deploy(RewardTracker__factory, {
    aliasName: "StakedXlxTracker",
    args: ["Fee + Staked XLX", "fsXLX"],
  });
  const stakedXlxDistributor = await deploy(RewardDistributor__factory, {
    aliasName: "StakedXlxDistributor",
    args: [esXdx.address, stakedXlxTracker.address],
  });
  if (stakedXlxTracker.newlyDeployed || stakedXlxDistributor.newlyDeployed) {
    const tx = await stakedXlxTracker.contract.initialize(
      [feeXlxTracker.address],
      stakedXlxDistributor.address,
    );
    console.log("Initialize StakedXlxTracker at ", tx.hash);
    await tx.wait();
  }
  if (stakedXlxTracker.newlyDeployed) {
    let tx = await stakedXlxTracker.contract.setInPrivateTransferMode(true);
    console.log("Set private transfer mode to StakedXlxTracker at ", tx.hash);
    await tx.wait();
    tx = await stakedXlxTracker.contract.setInPrivateStakingMode(true);
    console.log("Set private staking mode to StakedXlxTracker at ", tx.hash);
    await tx.wait();
    tx = await esXdx.setHandler(stakedXlxTracker.address, true);
    console.log("Set StakedXlxTracker to handler of EsXdx at ", tx.hash);
    await tx.wait();
  }
  if (stakedXlxDistributor.newlyDeployed) {
    let tx = await stakedXlxDistributor.contract.updateLastDistributionTime();
    console.log("Update last distribution time of StakedXlxDistributor at ", tx.hash);
    await tx.wait();
    tx = await esXdx.setHandler(stakedXlxDistributor.address, true);
    console.log("Set StakedXlxDistributor to handler of EsXdx at ", tx.hash);
    await tx.wait();
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
    let tx = await esXdx.setHandler(xdxVester.address, true);
    console.log("Set XdxVester to handler of EsXdx at ", tx.hash);
    await tx.wait();
    tx = await esXdx.setMinter(xdxVester.address, true);
    console.log("Set XdxVester to minter of EsXdx at ", tx.hash);
    await tx.wait();
  }

  const xlxVester = await deploy(Vester__factory, {
    aliasName: "XlxVester",
    args: [
      "Vested XLX", // _name
      "vXLX", // _symbol
      vestingDuration, // _vestingDuration
      esXdx.address, // _esToken
      stakedXlxTracker.address, // _pairToken
      xdx.address, // _claimableToken
      stakedXlxTracker.address, // _rewardTracker
    ],
  });
  if (xlxVester.newlyDeployed) {
    let tx = await esXdx.setHandler(xlxVester.address, true);
    console.log("Set XlxVester to handler of EsXdx at ", tx.hash);
    await tx.wait();
    tx = await esXdx.setMinter(xlxVester.address, true);
    console.log("Set XlxVester to minter of EsXdx at ", tx.hash);
    await tx.wait();
  }

  const rewardRouter = await deploy(RewardRouterV2__factory);
  if (rewardRouter.newlyDeployed) {
    const tx = await rewardRouter.contract.initialize(
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
    console.log("Initialize rewardRouter at ", tx.hash);
    await tx.wait();
  }
  if (rewardRouter.newlyDeployed) {
    // allow rewardRouter to burn bnXdx
    let tx = await bnXdx.setMinter(rewardRouter.address, true);
    console.log("Set RewardRouter to minter of BnXdx at ", tx.hash);
    await tx.wait();
    tx = await esXdx.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of EsXdx at ", tx.hash);
    await tx.wait();
  }

  if (stakedXdxTracker.newlyDeployed || rewardRouter.newlyDeployed) {
    // allow rewardRouter to stake in stakedXdxTracker
    const tx = await stakedXdxTracker.contract.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of StakedXdxTracker at ", tx.hash);
    await tx.wait();
  }

  if (stakedXdxTracker.newlyDeployed || bonusXdxTracker.newlyDeployed) {
    // allow bonusXdxTracker to stake stakedXdxTracker
    const tx = await stakedXdxTracker.contract.setHandler(bonusXdxTracker.address, true);
    console.log("Set BonusXdxTracker to handler of StakedXdxTracker at ", tx.hash);
    await tx.wait();
  }

  if (bonusXdxTracker.newlyDeployed || rewardRouter.newlyDeployed) {
    // allow rewardRouter to stake in bonusXdxTracker
    const tx = await bonusXdxTracker.contract.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of BonusXdxTracker at ", tx.hash);
    await tx.wait();
  }

  if (bonusXdxTracker.newlyDeployed || feeXdxTracker.newlyDeployed) {
    // allow bonusXdxTracker to stake feeXdxTracker
    const tx = await bonusXdxTracker.contract.setHandler(feeXdxTracker.address, true);
    console.log("Set FeeXdxTracker to handler of BonusXdxTracker at ", tx.hash);
    await tx.wait();
  }

  if (feeXdxTracker.newlyDeployed || rewardRouter.newlyDeployed) {
    // allow rewardRouter to stake in feeXdxTracker
    const tx = await feeXdxTracker.contract.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of FeeXdxTracker at ", tx.hash);
    await tx.wait();
  }

  if (feeXlxTracker.newlyDeployed || stakedXlxTracker.newlyDeployed) {
    // allow stakedXlxTracker to stake feeXlxTracker
    const tx = await feeXlxTracker.contract.setHandler(stakedXlxTracker.address, true);
    console.log("Set StakedXlxTracker to handler of FeeXlxTracker at ", tx.hash);
    await tx.wait();
  }

  if (feeXlxTracker.newlyDeployed || rewardRouter.newlyDeployed) {
    // allow rewardRouter to stake in feeXlxTracker
    const tx = await feeXlxTracker.contract.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of FeeXlxTracker at ", tx.hash);
    await tx.wait();
  }

  if (stakedXlxTracker.newlyDeployed || rewardRouter.newlyDeployed) {
    // allow rewardRouter to stake in stakedXlxTracker
    const tx = await stakedXlxTracker.contract.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of StakedXlxTracker at ", tx.hash);
    await tx.wait();
  }

  if (xdxVester.newlyDeployed || rewardRouter.newlyDeployed) {
    const tx = await xdxVester.contract.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of XdxVester at ", tx.hash);
    await tx.wait();
  }

  if (xlxVester.newlyDeployed || rewardRouter.newlyDeployed) {
    const tx = await xlxVester.contract.setHandler(rewardRouter.address, true);
    console.log("Set RewardRouter to handler of XlxVester at ", tx.hash);
    await tx.wait();
  }

  if (feeXdxTracker.newlyDeployed || xdxVester.newlyDeployed) {
    const tx = await feeXdxTracker.contract.setHandler(xdxVester.address, true);
    console.log("Set XdxVester to handler of FeeXdxTracker at ", tx.hash);
    await tx.wait();
  }

  if (stakedXlxTracker.newlyDeployed || xlxVester.newlyDeployed) {
    const tx = await stakedXlxTracker.contract.setHandler(xlxVester.address, true);
    console.log("Set XlxVester to handler of StakedXlxTracker at ", tx.hash);
    await tx.wait();
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
