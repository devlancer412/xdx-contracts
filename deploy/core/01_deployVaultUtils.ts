import { DeployFunction } from "hardhat-deploy/types";
import { VaultUtils__factory, Vault__factory } from "../../types";
import { Ship } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const vault = await connect(Vault__factory);

  await deploy(VaultUtils__factory, {
    args: [vault.address],
  });
};

export default func;
func.tags = ["vaultUtils"];
func.dependencies = ["vault"];
