import { GoogleGenAI, Type } from "@google/genai";
import { Match, MatchScore, MatchStatus, Market } from "../types";

// KEY FROM ENVIRONMENT VARIABLE
// If this is missing or invalid, the service will automatically failover to mock data.
const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export interface SimulatedMatchResult {
  score: MatchScore;
  summary: string;
}

// --- FALLBACK MOCK DATA GENERATOR ---
const TEAMS = [
  "Real Madrid", "Barcelona", "Man City", "Liverpool", "Arsenal", "Bayern Munich", 
  "PSG", "Juventus", "Inter Milan", "AC Milan", "Chelsea", "Man Utd", 
  "Dortmund", "Atletico Madrid", "Napoli", "Tottenham"
];

const LEAGUES = [
  "Champions League", "Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1"
];

const getRandomItem = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const getRandomOdds = () => Number((Math.random() * 2 + 1.1).toFixed(2));

const generateMockMarkets = (home: string, away: string): Market[] => {
    const ho = getRandomOdds();
    const ao = getRandomOdds();
    const do_ = Number((Math.random() * 2 + 2.5).toFixed(2));
    
    return [
        {
            id: 'm_res', name: 'Full Time Result', category: 'Main',
            options: [
                { id: '1', name: home, odds: ho },
                { id: 'X', name: 'Draw', odds: do_ },
                { id: '2', name: away, odds: ao },
            ]
        },
        {
            id: 'm_goals_25', name: 'Total Goals 2.5', category: 'Goals',
            options: [
                { id: 'O2.5', name: 'Over 2.5', odds: 1.85 },
                { id: 'U2.5', name: 'Under 2.5', odds: 1.95 },
            ]
        }
    ];
};

const getFallbackLiveMatches = (): Match[] => {
    const matches: Match[] = [];
    for (let i = 0; i < 5; i++) {
        const home = getRandomItem(TEAMS);
        let away = getRandomItem(TEAMS);
        while (away === home) away = getRandomItem(TEAMS);
        
        matches.push({
            id: `mock_live_${Date.now()}_${i}`,
            league: getRandomItem(LEAGUES),
            homeTeam: home,
            awayTeam: away,
            startTime: new Date().toISOString(),
            status: MatchStatus.LIVE,
            isLive: true,
            currentMinute: `${Math.floor(Math.random() * 80) + 1}'`,
            liveHomeScore: Math.floor(Math.random() * 3),
            liveAwayScore: Math.floor(Math.random() * 3),
            markets: generateMockMarkets(home, away),
            sourceUrls: []
        });
    }
    return matches;
};

const getFallbackUpcomingMatches = (context: string): Match[] => {
    const matches: Match[] = [];
    const count = 10;
    
    for (let i = 0; i < count; i++) {
        const home = getRandomItem(TEAMS);
        let away = getRandomItem(TEAMS);
        while (away === home) away = getRandomItem(TEAMS);
        
        const date = new Date();
        date.setHours(date.getHours() + i * 2);

        matches.push({
            id: `mock_up_${Date.now()}_${i}`,
            league: context === 'All Top Football' ? getRandomItem(LEAGUES) : context,
            homeTeam: home,
            awayTeam: away,
            startTime: date.toISOString(),
            status: MatchStatus.UPCOMING,
            markets: generateMockMarkets(home, away),
            sourceUrls: []
        });
    }
    return matches;
};

// --- END MOCK GENERATOR ---

// Helper: Generates detailed markets for real API matches
const generateMarketsForMatch = (home: string, away: string, baseHomeOdds: number, baseAwayOdds: number, baseDrawOdds: number): Market[] => {
  return [
    {
      id: 'm_res',
      name: 'Full Time Result',
      category: 'Main',
      options: [
        { id: '1', name: home, odds: baseHomeOdds },
        { id: 'X', name: 'Draw', odds: baseDrawOdds },
        { id: '2', name: away, odds: baseAwayOdds },
      ]
    },
    {
      id: 'm_goals_25',
      name: 'Total Goals 2.5',
      category: 'Goals',
      options: [
        { id: 'O2.5', name: 'Over 2.5', odds: 1.85 },
        { id: 'U2.5', name: 'Under 2.5', odds: 1.85 },
      ]
    },
    {
        id: 'm_btts', name: 'Both Teams To Score', category: 'Goals',
        options: [
          { id: 'Yes', name: 'Yes', odds: 1.70 },
          { id: 'No', name: 'No', odds: 2.05 },
        ]
    }
  ];
};

export const fetchLiveMatches = async (): Promise<Match[]> => {
    if (!apiKey) {
        console.warn("No API Key found, using fallback data.");
        return getFallbackLiveMatches();
    }

    try {
        const prompt = `
            ACT AS A SPORTS DATA API.
            TASK: Fetch ALL currently LIVE football matches from major leagues.
            OUTPUT JSON: [{ "league": "string", "homeTeam": "string", "awayTeam": "string", "currentMinute": "string", "liveScore": { "home": number, "away": number }, "odds": { "home": number, "draw": number, "away": number } }]
        `;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] }
        });

        const text = response.text || '';
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```([\s\S]*?)```/);

        if (jsonMatch && jsonMatch[1]) {
            const rawData = JSON.parse(jsonMatch[1]);
            const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            const sourceUrls = groundingChunks.map(chunk => chunk.web?.uri).filter((uri): uri is string => !!uri);

            return rawData.map((item: any) => ({
                id: `live_${item.homeTeam.replace(/\s+/g, '')}_${item.awayTeam.replace(/\s+/g, '')}`,
                league: item.league || 'Global Live',
                homeTeam: item.homeTeam,
                awayTeam: item.awayTeam,
                startTime: new Date().toISOString(),
                status: MatchStatus.LIVE,
                isLive: true,
                currentMinute: item.currentMinute || "LIVE",
                liveHomeScore: item.liveScore?.home || 0,
                liveAwayScore: item.liveScore?.away || 0,
                markets: generateMarketsForMatch(
                    item.homeTeam, item.awayTeam,
                    item.odds?.home || 2.0, item.odds?.away || 2.0, item.odds?.draw || 3.0
                ),
                sourceUrls: sourceUrls.slice(0, 3)
            }));
        }
        throw new Error("Invalid JSON from API");
    } catch (e) {
        console.error("Live API Error, using fallback", e);
        return getFallbackLiveMatches();
    }
}

export const fetchUpcomingMatches = async (queryContext: string): Promise<Match[]> => {
  if (!apiKey) {
      console.warn("No API Key found, using fallback data.");
      return getFallbackUpcomingMatches(queryContext);
  }

  try {
    const prompt = `
      ACT AS A BOOKMAKER FEED.
      TASK: Fetch football matches for NEXT 7 DAYS.
      CONTEXT: ${queryContext}.
      OUTPUT JSON: [{ "league": "string", "homeTeam": "string", "awayTeam": "string", "startTime": "ISO String", "odds": { "home": number, "draw": number, "away": number } }]
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] }
    });

    const text = response.text || '';
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```([\s\S]*?)```/);
    
    if (jsonMatch && jsonMatch[1]) {
      const rawData = JSON.parse(jsonMatch[1]);
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sourceUrls = groundingChunks.map(chunk => chunk.web?.uri).filter((uri): uri is string => !!uri);

      return rawData.map((item: any, idx: number) => ({
        id: `up_${Date.now()}_${idx}`,
        league: item.league || queryContext,
        homeTeam: item.homeTeam,
        awayTeam: item.awayTeam,
        startTime: item.startTime,
        status: MatchStatus.UPCOMING,
        markets: generateMarketsForMatch(
          item.homeTeam, item.awayTeam, 
          item.odds?.home || 2.0, item.odds?.away || 2.0, item.odds?.draw || 3.0
        ),
        sourceUrls: sourceUrls.slice(0, 3)
      }));
    }
    throw new Error("Invalid JSON from API");
  } catch (error) {
    console.error("Upcoming API Error, using fallback", error);
    return getFallbackUpcomingMatches(queryContext);
  }
};

export const simulateMatchResult = async (match: Match): Promise<SimulatedMatchResult> => {
  // Simple fallback simulation if API is missing
  if (!apiKey) {
      const h = Math.floor(Math.random() * 4);
      const a = Math.floor(Math.random() * 4);
      return {
          score: {
              home: h, away: a, htHome: Math.floor(h/2), htAway: Math.floor(a/2),
              homeYellowCards: 1, awayYellowCards: 2, homeCorners: 5, awayCorners: 3, scorers: []
          },
          summary: "Simulated Match (Offline Mode)"
      };
  }

  try {
    const prompt = `
      Simulate FINAL result for: ${match.homeTeam} vs ${match.awayTeam}.
      JSON Output: { homeScore, awayScore, htHome, htAway, homeYellowCards, awayYellowCards, homeCorners, awayCorners, scorers: [], summary }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      return {
        score: {
          home: data.homeScore, away: data.awayScore,
          htHome: data.htHome, htAway: data.htAway,
          homeYellowCards: data.homeYellowCards, awayYellowCards: data.awayYellowCards,
          homeCorners: data.homeCorners, awayCorners: data.awayCorners,
          scorers: data.scorers || []
        },
        summary: data.summary
      };
    }
    throw new Error("Empty response");
  } catch (error) {
    return {
      score: { home: 0, away: 0, htHome: 0, htAway: 0, homeYellowCards: 0, awayYellowCards: 0, homeCorners: 0, awayCorners: 0, scorers: [] },
      summary: "Simulation failed."
    };
  }
};