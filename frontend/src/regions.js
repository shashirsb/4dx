export const REGIONS = [
  { id: 'global', label: 'Global / Multi-region', flag: '🌍', currency: 'USD', timezone: 'UTC', orgType: 'enterprise' },
  { id: 'sg', label: 'Singapore', flag: '🇸🇬', currency: 'SGD', timezone: 'Asia/Singapore', orgType: 'public_sector' },
  { id: 'cn', label: 'China', flag: '🇨🇳', currency: 'CNY', timezone: 'Asia/Shanghai', orgType: 'public_sector' },
  { id: 'in', label: 'India', flag: '🇮🇳', currency: 'INR', timezone: 'Asia/Kolkata', orgType: 'government' },
  { id: 'eu', label: 'European Union', flag: '🇪🇺', currency: 'EUR', timezone: 'Europe/Brussels', orgType: 'public_sector' },
  { id: 'uk', label: 'United Kingdom', flag: '🇬🇧', currency: 'GBP', timezone: 'Europe/London', orgType: 'government' },
  { id: 'de', label: 'Germany', flag: '🇩🇪', currency: 'EUR', timezone: 'Europe/Berlin', orgType: 'public_sector' },
  { id: 'fr', label: 'France', flag: '🇫🇷', currency: 'EUR', timezone: 'Europe/Paris', orgType: 'government' },
  { id: 'us', label: 'United States', flag: '🇺🇸', currency: 'USD', timezone: 'America/New_York', orgType: 'enterprise' },
  { id: 'jp', label: 'Japan', flag: '🇯🇵', currency: 'JPY', timezone: 'Asia/Tokyo', orgType: 'public_sector' },
  { id: 'au', label: 'Australia', flag: '🇦🇺', currency: 'AUD', timezone: 'Australia/Sydney', orgType: 'government' },
];

export function regionById(id) {
  return REGIONS.find(r => r.id === id) || REGIONS[0];
}
