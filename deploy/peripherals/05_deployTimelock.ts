import { DeployFunction } from "hardhat-deploy/types";
import {
  PositionManager__factory,
  PositionRouter__factory,
  ReferralStorage__factory,
  RewardRouterV2__factory,
  Timelock__factory,
  TokenManager__factory,
  VaultUtils__factory,
  Vault__factory,
  XDX__factory,
  XlxManager__factory,
} from "../../types";
import { Ship, toWei } from "../../utils";
import { handlers as configHandlers, orderKeepers as configOrderKeepers } from "./../../config/accounts";

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);
  const { deployer, handler1, handler2, orderKeeper1, orderKeeper2 } = accounts;

  const buffer = 24 * 60 * 60;
  const maxTokenSupply = toWei(13250000, 18);

  let handlers: string[];
  let keepers: string[];

  if (hre.network.tags.prod) {
    handlers = configHandlers;
    keepers = configOrderKeepers;
  } else {
    handlers = [handler1.address, handler2.address];
    keepers = [orderKeeper1.address, orderKeeper2.address];
  }

  const vault = await connect(Vault__factory);
  const vaultUtils = await connect(VaultUtils__factory);
  const tokenManager = await connect(TokenManager__factory);
  const xlxManager = await connect(XlxManager__factory);
  const rewardRouter = await connect(RewardRouterV2__factory);
  const positionRouter = await connect(PositionRouter__factory);
  const positionManager = await connect(PositionManager__factory);
  const referralStorage = await connect(ReferralStorage__factory);
  const xdx = await connect(XDX__factory);

  const timelock = await deploy(Timelock__factory, {
    args: [
      deployer.address, // admin
      buffer, // buffer
      tokenManager.address, // tokenManager
      tokenManager.address, // mintReceiver
      xlxManager.address, // glpManager
      rewardRouter.address, // rewardRouter
      maxTokenSupply, // maxTokenSupply
      10, // marginFeeBasisPoints 0.1%
      500, // maxMarginFeeBasisPoints 5%
    ],
  });

  if (timelock.newlyDeployed) {
    await timelock.contract.setShouldToggleIsLeverageEnabled(true);
    await timelock.contract.setContractHandler(positionRouter.address, true);
    await timelock.contract.setContractHandler(positionManager.address, true);

    if (hre.network.tags.live) {
      await vault.setGov(timelock.address);
      await timelock.contract.setVaultUtils(vault.address, vaultUtils.address);

      if (!(await vault.isLiquidator(positionManager.address))) {
        await timelock.contract.setLiquidator(vault.address, positionManager.address, true);
      }
    }

    await timelock.contract.signalSetHandler(referralStorage.address, positionRouter.address, true);
    await timelock.contract.signalApprove(xdx.address, deployer.address, "1000000000000000000");

    for (const handler of handlers) {
      await timelock.contract.setContractHandler(handler, true);
    }

    for (const keeper of keepers) {
      await timelock.contract.setKeeper(keeper, true);
    }
  }
};

export default func;
func.tags = ["timelock"];
func.dependencies = [
  "vault",
  "vaultUtils",
  "tokenManager",
  "xlxManager",
  "rewardRouter",
  "positionRouter",
  "positionManager",
  "referralStorage",
  "xdx",
];
