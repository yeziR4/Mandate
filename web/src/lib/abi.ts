export const arenaAbi = [
  {
    type: "function",
    name: "modelCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "attemptFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint96" }],
  },
  {
    type: "function",
    name: "cooldown",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "open",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "purseOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint8" }],
    outputs: [{ type: "uint96" }],
  },
  {
    type: "function",
    name: "getModel",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint8" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "label", type: "string" },
          { name: "mandateHash", type: "bytes32" },
          { name: "purse", type: "uint96" },
          { name: "attemptCount", type: "uint32" },
          { name: "breaker", type: "address" },
          { name: "brokenAt", type: "uint64" },
          { name: "broken", type: "bool" },
          { name: "configured", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "scenario",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "mandateOf",
    stateMutability: "view",
    inputs: [{ name: "scenario", type: "uint16" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "attemptCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "submitAttempt",
    stateMutability: "nonpayable",
    inputs: [
      { name: "model", type: "uint8" },
      { name: "commit", type: "bytes32" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "AttemptSubmitted",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "model", type: "uint8", indexed: true },
      { name: "submitter", type: "address", indexed: true },
      { name: "commit", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ModelBroken",
    inputs: [
      { name: "model", type: "uint8", indexed: true },
      { name: "breaker", type: "address", indexed: true },
      { name: "purse", type: "uint96", indexed: false },
      { name: "certificateId", type: "uint256", indexed: false },
    ],
  },
] as const;

export const certificateAbi = [
  {
    type: "function",
    name: "totalMinted",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "label",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "certs",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "model", type: "uint8" },
      { name: "severity", type: "uint8" },
      { name: "transcriptHash", type: "bytes32" },
      { name: "brokenAt", type: "uint64" },
      { name: "attemptId", type: "uint256" },
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
