import { DeployFunction } from "hardhat-deploy/types";
import {
  Router__factory,
  OrderBook__factory,
  Vault__factory,
  ShortsTracker__factory,
  PositionManager__factory,
  ReferralStorage__factory,
  Timelock__factory,
} from "../../types";
import { Ship } from "../../utils";
import { NativeToken, tokens } from "../../config";

const depositFee = 30; // 0.3%

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);

  const { orderKeeper0, orderKeeper1, liquidator } = accounts;
  let orderKeepers: string[];
  let liquidators: string[];

  const nativeToken = tokens.avax.nativeToken as NativeToken;

  if (hre.network.tags.prod) {
    orderKeepers = [];
    liquidators = [];
  } else {
    orderKeepers = [orderKeeper0.address, orderKeeper1.address];
    liquidators = [liquidator.address];

    const nativeTokenContract = await connect(nativeToken.name);
    nativeToken.address = nativeTokenContract.address;
  }

  const vault = await connect(Vault__factory);
  const router = await connect(Router__factory);
  const shortsTracker = await connect(ShortsTracker__factory);
  const orderbook = await connect(OrderBook__factory);
  const referralStorage = await connect(ReferralStorage__factory);

  const positionManager = await deploy(PositionManager__factory, {
    args: [
      vault.address,
      router.address,
      shortsTracker.address,
      nativeToken.address,
      depositFee,
      orderbook.address,
    ],
  });

  if (positionManager.newlyDeployed) {
    await positionManager.contract.setReferralStorage(referralStorage.address);
    await positionManager.contract.setShouldValidateIncreaseOrder(false);
  }

  for (const orderKeeper of orderKeepers) {
    if (!(await positionManager.contract.isOrderKeeper(orderKeeper))) {
      await positionManager.contract.setOrderKeeper(orderKeeper, true);
    }
  }

  for (const liquidator of liquidators) {
    if (!(await positionManager.contract.isLiquidator(liquidator))) {
      await positionManager.contract.setLiquidator(liquidator, true);
    }
  }

  if (!(await shortsTracker.isHandler(positionManager.address))) {
    await shortsTracker.setHandler(positionManager.address, true);
  }
  if (!(await router.plugins(positionManager.address))) {
    await router.addPlugin(positionManager.address);
  }

  if ((await positionManager.contract.gov()) != (await vault.gov())) {
    await positionManager.contract.setGov(await vault.gov());
  }
};

export default func;
func.tags = ["positionManager"];
func.dependencies = ["vault", "shortsTracker", "router", "tokens", "orderbook", "referralStorage"];
