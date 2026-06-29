/**
 * USDC (ERC-20) contract wrapper for Arc Testnet.
 *
 * Exposes typed reads + writes against the deployed USDC contract.
 * The 6-decimal view of balances/values is the one used everywhere in the app.
 */
import {
  encodeFunctionData,
  decodeFunctionResult,
  type Hex,
  type Address,
} from 'viem';
import { getArcPublicClient } from './arc';
import { getEnv } from '@pazzera/core';

// Minimal ABI — only the functions we actually call.
const USDC_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
  },
] as const;

export function usdcAddress(): Address {
  return getEnv().USDC_CONTRACT_ADDRESS as Address;
}

export function usdcDecimals(): number {
  return getEnv().USDC_DECIMALS;
}

/** Convert decimal USDC string ("1.5") to base units ("1500000"). */
export function usdcToBaseUnits(amount: string | number): bigint {
  const str = typeof amount === 'number' ? amount.toString() : amount;
  const [whole, frac = ''] = str.split('.');
  const decimals = usdcDecimals();
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt((whole || '0') + fracPadded);
}

/** Convert base units ("1500000") to decimal USDC string ("1.5"). */
export function baseUnitsToUsdc(units: bigint | string): string {
  const big = typeof units === 'string' ? BigInt(units) : units;
  const decimals = usdcDecimals();
  const factor = 10n ** BigInt(decimals);
  const whole = big / factor;
  const frac = big % factor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}

export async function getBalance(address: Address): Promise<bigint> {
  const client = getArcPublicClient();
  const data = encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
  const result = await client.call({ to: usdcAddress(), data });
  const decoded = decodeFunctionResult({
    abi: USDC_ABI,
    functionName: 'balanceOf',
    data: result.data ?? '0x',
  });
  return decoded as bigint;
}

export function encodeTransfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'transfer',
    args: [to, amount],
  });
}

export function encodeTransferWithAuthorization(args: {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  v: number;
  r: Hex;
  s: Hex;
}): Hex {
  return encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'transferWithAuthorization',
    args: [
      args.from,
      args.to,
      args.value,
      args.validAfter,
      args.validBefore,
      args.nonce,
      args.v,
      args.r,
      args.s,
    ],
  });
}

export const USDC_ABI_EXPORT = USDC_ABI;