import { ContractTransaction } from "ethers";

export const reportGasUsed = async (tx: ContractTransaction, label: string) => {
  const { gasUsed } = await tx.wait();
  console.info(label, gasUsed.toString());
  return gasUsed;
};
