import { Match, MatchStatus, User, UserRole, Market } from './types';

export const INITIAL_USERS: User[] = [
  {
    id: 'a1',
    name: 'Master Admin',
    username: 'root',
    password: 'root',
    balance: 1000000,
    role: UserRole.ADMIN,
    avatar: 'https://ui-avatars.com/api/?name=Admin&background=126e51&color=fff'
  },
  {
    id: 'u1',
    name: 'Player One',
    username: 'player1',
    password: '123',
    balance: 250.00,
    role: UserRole.USER,
    avatar: 'https://ui-avatars.com/api/?name=Player+One&background=random'
  }
];

// We export an empty array because the user wants ONLY real data from the API.
export const INITIAL_MATCHES: Match[] = [];