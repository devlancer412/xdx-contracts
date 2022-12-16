import { DeployFunction } from "hardhat-deploy/types";
import {
  PositionManager__factory,
  PositionRouter__factory,
  ReferralStorage__factory,
  RewardRouter__factory,
  Timelock__factory,
  TokenManager__factory,
  VaultUtils__factory,
  Vault__factory,
  XDX__factory,
  XlxManager__factory,
} from "../../types";
import { Ship, toWei } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);
  const { deployer, alice, bob, keeper1, keeper2 } = accounts;

  const buffer = 24 * 60 * 60;
  const maxTokenSupply = toWei(13250000, 18);

  let handlers: string[];
  let keepers: string[];

  if (hre.network.tags.prod) {
    handlers = [];
    keepers = [];
  } else {
    handlers = [alice.address, bob.address];
    keepers = [keeper1.address, keeper2.address];
  }

  const vault = await connect(Vault__factory);
  const vaultUtils = await connect(VaultUtils__factory);
  const tokenManager = await connect(TokenManager__factory);
  const xlxManager = await connect(XlxManager__factory);
  const rewardRouter = await connect(RewardRouter__factory);
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
    await timelock.contract.setVaultUtils(vault.address, vaultUtils.address);
    await timelock.contract.setContractHandler(positionManager.address, true);
    await timelock.contract.signalSetHandler(referralStorage.address, positionRouter.address, true);
    await timelock.contract.signalApprove(xdx.address, deployer.address, "1000000000000000000");

    for (const handler of handlers) {
      await timelock.contract.setContractHandler(handler, true);
    }

    for (const keeper of keepers) {
      await timelock.contract.setKeeper(keeper, true);
    }
  }

  if (!(await vault.isLiquidator(positionManager.address))) {
    await timelock.contract.setLiquidator(vault.address, positionManager.address, true);
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
