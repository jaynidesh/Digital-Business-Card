export type WalletPlatform = 'apple' | 'google';

export function walletUrl(publicToken: string, platform: WalletPlatform): string {
  return `/api/v1/public/contact/${encodeURIComponent(publicToken)}/wallet/${platform}`;
}

export function visibleWallets(userAgent: string, platform = '', maxTouchPoints = 0): WalletPlatform[] {
  if (/Android/i.test(userAgent)) return ['google'];
  if (/iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return ['apple'];
  return ['apple', 'google'];
}
