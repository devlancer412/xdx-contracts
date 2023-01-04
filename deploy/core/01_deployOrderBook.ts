import { DeployFunction } from "hardhat-deploy/types";
import { Router__factory, USDG__factory, Vault__factory, OrderBook__factory } from "../../types";
import { Ship, toWei } from "../../utils";
import { NativeToken, tokens } from "../../config";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  let network = hre.network.name;
  if (network != "avax" && network != "avax_test") {
    network = "avax";
  }
  const nativeToken = tokens[network as "avax" | "avax_test"].nativeToken as NativeToken;

  if (!hre.network.tags.prod) {
    const nativeTokenContract = await connect(nativeToken.name);

    nativeToken.address = nativeTokenContract.address;
  }

  const orderbook = await deploy(OrderBook__factory);

  if (orderbook.newlyDeployed) {
    const router = await connect(Router__factory);
    const vault = await connect(Vault__factory);
    const usdg = await connect(USDG__factory);

    const tx = await orderbook.contract.initialize(
      router.address, // router
      vault.address, // vault
      nativeToken.address, // weth
      usdg.address, // usdg
      "10000000000000000", // 0.01 AVAX
      toWei(10, 30), // min purchase token amount usd
    );
    console.log("Inintialize Orderbook at ", tx.hash);
    await tx.wait();
  }
};

export default func;
func.tags = ["orderbook"];
func.dependencies = ["vault", "usdg", "router", "tokens"];
