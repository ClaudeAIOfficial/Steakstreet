export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
] as const;

export const VAULT_ABI = [
  "function asset() view returns (address)",
  "function aprBps() view returns (uint256)",
  "function rewardReserve() view returns (uint256)",
  "function principalOf(address) view returns (uint256)",
  "function earned(address) view returns (uint256)",
  "function stake(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claim()"
] as const;
