const { ethers } = require("ethers");

const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

class Web3Service {
  constructor({ rpcUrl, tokenAddress, housePrivateKey }) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.houseWallet = housePrivateKey
      ? new ethers.Wallet(housePrivateKey, this.provider)
      : ethers.Wallet.createRandom().connect(this.provider);

    this.housePrivateKey = housePrivateKey;
    this.tokenAddress = tokenAddress;

    this.tokenHouse = new ethers.Contract(this.tokenAddress, ERC20_ABI, this.houseWallet);
    this.tokenRead = new ethers.Contract(this.tokenAddress, ERC20_ABI, this.provider);
    this.tokenInterface = new ethers.utils.Interface(ERC20_ABI);

    this.tokenDecimals = 18;
    this.tokenSymbol = "DBET";
  }

  async init() {
    try {
      this.tokenDecimals = await this.tokenRead.decimals();
      this.tokenSymbol = await this.tokenRead.symbol();
    } catch (error) {
      console.warn("Token metadata lookup failed:", error.message || error);
    }
  }

  getTokenMeta() {
    return {
      decimals: this.tokenDecimals,
      symbol: this.tokenSymbol
    };
  }

  getHouseAddress() {
    return this.houseWallet.address;
  }

  async verifyTx(txHash, userAddress) {
    if (!txHash || typeof txHash !== "string") throw new Error("Bad txHash");
    if (!userAddress || typeof userAddress !== "string") throw new Error("Bad wallet");

    const receipt = await this.provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) throw new Error("Tx failed or pending");

    const userLc = userAddress.toLowerCase();
    const houseLc = this.houseWallet.address.toLowerCase();

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.tokenAddress.toLowerCase()) continue;
      try {
        const parsed = this.tokenInterface.parseLog(log);
        const from = String(parsed.args.from).toLowerCase();
        const to = String(parsed.args.to).toLowerCase();
        if (from === userLc && to === houseLc) {
          return parsed.args.value;
        }
      } catch (error) {
        continue;
      }
    }

    throw new Error("No valid token transfer to house found");
  }

  async payWinner(userAddress, payoutWeiBn) {
    if (!this.housePrivateKey) {
      return { ok: false, error: "House key missing" };
    }

    try {
      const bal = await this.tokenHouse.balanceOf(this.houseWallet.address);
      if (bal.lt(payoutWeiBn)) throw new Error("House balance too low");

      const tx = await this.tokenHouse.transfer(userAddress, payoutWeiBn);
      return { ok: true, txHash: tx.hash };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  }
}

module.exports = Web3Service;
