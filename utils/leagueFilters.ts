// The league selection is a single string: a league key, or one of these special values.
export const ALL_LEAGUES = 'All Top Football';
export const FAVORITES = 'FAVORITES';

const COUNTRY_FILTER_PREFIX = 'COUNTRY:';
export const countryFilterKey = (country: string): string => `${COUNTRY_FILTER_PREFIX}${country}`;
export const isCountryFilter = (key: string): boolean => key.startsWith(COUNTRY_FILTER_PREFIX);
export const countryFromFilter = (key: string): string => key.slice(COUNTRY_FILTER_PREFIX.length);
