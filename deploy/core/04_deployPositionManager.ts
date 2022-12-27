import { DeployFunction } from "hardhat-deploy/types";
import {
  Router__factory,
  OrderBook__factory,
  Vault__factory,
  ShortsTracker__factory,
  PositionManager__factory,
  ReferralStorage__factory,
} from "../../types";
import { Ship } from "../../utils";
import {
  NativeToken,
  tokens,
  orderKeepers as configOrderKeepers,
  liquidators as configLiquidators,
} from "../../config";

const depositFee = 30; // 0.3%

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);

  const { orderKeeper1, orderKeeper2, liquidator } = accounts;
  let orderKeepers: string[];
  let liquidators: string[];

  const nativeToken = tokens[hre.network.name as "avax" | "avax_test"].nativeToken as NativeToken;

  if (hre.network.tags.prod) {
    orderKeepers = configOrderKeepers;
    liquidators = configLiquidators;
  } else {
    orderKeepers = [orderKeeper1.address, orderKeeper2.address];
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
    let tx = await positionManager.contract.setReferralStorage(referralStorage.address);
    console.log("Set ReferralStorage to PositionManager at ", tx.hash);
    await tx.wait();
    tx = await positionManager.contract.setShouldValidateIncreaseOrder(false);
    console.log("Set should validate increaseOrder to PositionManager at ", tx.hash);
    await tx.wait();
  }

  for (const orderKeeper of orderKeepers) {
    if (!(await positionManager.contract.isOrderKeeper(orderKeeper))) {
      const tx = await positionManager.contract.setOrderKeeper(orderKeeper, true);
      console.log("Set", orderKeeper, "as orderKeeper of PositionManager at ", tx.hash);
      await tx.wait();
    }
  }

  for (const liquidator of liquidators) {
    if (!(await positionManager.contract.isLiquidator(liquidator))) {
      const tx = await positionManager.contract.setLiquidator(liquidator, true);
      console.log("Set", liquidator, "as liquidator of PositionManager at ", tx.hash);
      await tx.wait();
    }
  }

  if (!(await shortsTracker.isHandler(positionManager.address))) {
    const tx = await shortsTracker.setHandler(positionManager.address, true);
    console.log("Set PositionManager as handler of ShortsTracker at ", tx.hash);
    await tx.wait();
  }
  if (!(await router.plugins(positionManager.address))) {
    const tx = await router.addPlugin(positionManager.address);
    console.log("Set PositionManager as plugin of Router at ", tx.hash);
    await tx.wait();
  }

  // if ((await positionManager.contract.gov()) != (await vault.gov())) {
  //   await positionManager.contract.setGov(await vault.gov());
  // }
};

export default func;
func.tags = ["positionManager"];
func.dependencies = ["vault", "shortsTracker", "router", "tokens", "orderbook", "referralStorage"];
