// Display currencies offered in Settings. Amounts are always computed in USD and converted only for display.
export const CURRENCIES: { code: string; name: string }[] = [
  { code: 'USD', name: 'US dollar' }, { code: 'EUR', name: 'Euro' }, { code: 'GBP', name: 'British pound' },
  { code: 'KES', name: 'Kenyan shilling' }, { code: 'NGN', name: 'Nigerian naira' }, { code: 'ZAR', name: 'South African rand' },
  { code: 'GHS', name: 'Ghanaian cedi' }, { code: 'UGX', name: 'Ugandan shilling' }, { code: 'TZS', name: 'Tanzanian shilling' },
  { code: 'EGP', name: 'Egyptian pound' }, { code: 'INR', name: 'Indian rupee' }, { code: 'CAD', name: 'Canadian dollar' },
  { code: 'AUD', name: 'Australian dollar' }, { code: 'JPY', name: 'Japanese yen' }, { code: 'CNY', name: 'Chinese yuan' },
  { code: 'BRL', name: 'Brazilian real' }, { code: 'AED', name: 'UAE dirham' }, { code: 'CHF', name: 'Swiss franc' },
  { code: 'TRY', name: 'Turkish lira' }, { code: 'MXN', name: 'Mexican peso' },
];
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);
