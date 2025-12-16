import { GoogleGenAI, Type } from "@google/genai";
import { Match, MatchScore, MatchStatus, Market } from "../types";

// KEY FROM USER
const ai = new GoogleGenAI({ apiKey: 'e561350dff9c15fe7ab62157b6198913' });

export interface SimulatedMatchResult {
  score: MatchScore;
  summary: string;
}

// Helper: Real-feeling odds generator based on base probabilities
const generateMarketsForMatch = (home: string, away: string, baseHomeOdds: number, baseAwayOdds: number, baseDrawOdds: number): Market[] => {
  const isHomeFav = baseHomeOdds < baseAwayOdds;
  
  return [
    // --- MAIN ---
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
      id: 'm_dc',
      name: 'Double Chance',
      category: 'Main',
      options: [
        { id: '1X', name: `${home} or Draw`, odds: Number((1 + (1/(1/baseHomeOdds + 1/baseDrawOdds))).toFixed(2)) - 0.15 },
        { id: '12', name: `${home} or ${away}`, odds: 1.25 },
        { id: 'X2', name: `Draw or ${away}`, odds: Number((1 + (1/(1/baseAwayOdds + 1/baseDrawOdds))).toFixed(2)) - 0.15 },
      ]
    },
    {
      id: 'm_goals_25',
      name: 'Total Goals Over/Under 2.5',
      category: 'Goals',
      options: [
        { id: 'O2.5', name: 'Over 2.5', odds: 1.90 },
        { id: 'U2.5', name: 'Under 2.5', odds: 1.90 },
      ]
    },
    {
      id: 'm_btts',
      name: 'Both Teams To Score',
      category: 'Goals',
      options: [
        { id: 'Yes', name: 'Yes', odds: 1.75 },
        { id: 'No', name: 'No', odds: 2.05 },
      ]
    },
    {
      id: 'm_ht',
      name: 'Half Time Result',
      category: 'Half',
      options: [
        { id: 'HT1', name: home, odds: Number((baseHomeOdds * 1.55).toFixed(2)) },
        { id: 'HTX', name: 'Draw', odds: 2.15 },
        { id: 'HT2', name: away, odds: Number((baseAwayOdds * 1.55).toFixed(2)) },
      ]
    },
    {
        id: 'm_corn_tot',
        name: 'Total Corners',
        category: 'Corners',
        options: [
            { id: 'C_O9.5', name: 'Over 9.5', odds: 1.85 },
            { id: 'C_U9.5', name: 'Under 9.5', odds: 1.85 },
        ]
    }
  ];
};

/**
 * Fetches currently LIVE matches with GLOBAL scope.
 */
export const fetchLiveMatches = async (): Promise<Match[]> => {
    try {
        const prompt = `
            TASK: Fetch currently LIVE (in-play) football matches from ANY active league in the world right now.
            SCOPE: Global (Europe, Asia, South America, Lower Divisions, Youth Leagues).
            
            STRICT REQUIREMENT: 
            - IGNORE friendly matches unless high profile.
            - Prioritize competitive leagues (Superliga, Premier, Serie A/B, La Liga 2, etc).
            - GET REAL LIVE SCORES and current minutes.
            
            OUTPUT FORMAT (Strict JSON Array):
            [
              {
                "league": "League Name (e.g., 'Albanian Superliga', 'Vietnam V-League')",
                "homeTeam": "Home Team Name",
                "awayTeam": "Away Team Name",
                "currentMinute": "Time (e.g. 35', 90+2')",
                "liveScore": { "home": 1, "away": 0 },
                "odds": { "home": 1.5, "draw": 3.5, "away": 6.0 }
              }
            ]
        `;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }]
            }
        });

        const text = response.text || '';
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```([\s\S]*?)```/);

        if (jsonMatch && jsonMatch[1]) {
            const rawData = JSON.parse(jsonMatch[1]);
            const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            const sourceUrls = groundingChunks.map(chunk => chunk.web?.uri).filter((uri): uri is string => !!uri);

            return rawData.map((item: any, idx: number) => ({
                id: `live_api_${Date.now()}_${idx}`,
                league: item.league || 'World Football',
                homeTeam: item.homeTeam,
                awayTeam: item.awayTeam,
                startTime: new Date().toISOString(),
                status: MatchStatus.LIVE,
                isLive: true,
                currentMinute: item.currentMinute || "LIVE",
                liveHomeScore: item.liveScore?.home || 0,
                liveAwayScore: item.liveScore?.away || 0,
                markets: generateMarketsForMatch(
                    item.homeTeam,
                    item.awayTeam,
                    item.odds?.home || 2.0,
                    item.odds?.away || 2.0,
                    item.odds?.draw || 3.0
                ),
                sourceUrls: sourceUrls.slice(0, 3)
            }));
        }
        return [];
    } catch (e) {
        console.error("Error fetching live matches", e);
        return []; 
    }
}

/**
 * Fetches upcoming matches for a specific context.
 */
export const fetchUpcomingMatches = async (queryContext: string): Promise<Match[]> => {
  try {
    // If context is "All Top Football", we widen the net massively
    const isGeneral = queryContext === 'All Top Football';
    
    const prompt = `
      TASK: Fetch real upcoming football matches schedule.
      CONTEXT: ${isGeneral ? "ALL Major & Minor Leagues (Premier League, Serie A, Albanian Superliga, La Liga, Bundesliga, Eredivisie, etc.)" : queryContext}.
      TIME RANGE: Next 48 hours.
      
      INSTRUCTIONS:
      1. Use Google Search to find confirmed fixtures.
      2. If "All Top Football", return a mix of at least 15-20 matches from different countries.
      3. Get 1X2 Odds for every match.

      OUTPUT FORMAT (Strict JSON Array):
      [
        {
          "league": "Exact League Name",
          "homeTeam": "Team A",
          "awayTeam": "Team B",
          "startTime": "ISO 8601 Date",
          "odds": { "home": 1.25, "draw": 4.5, "away": 9.0 }
        }
      ]
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sourceUrls = groundingChunks.map(chunk => chunk.web?.uri).filter((uri): uri is string => !!uri);

    const text = response.text || '';
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```([\s\S]*?)```/);
    
    if (jsonMatch && jsonMatch[1]) {
      const rawData = JSON.parse(jsonMatch[1]);
      
      return rawData.map((item: any, idx: number) => ({
        id: `real_api_${Date.now()}_${idx}`,
        league: item.league || queryContext,
        homeTeam: item.homeTeam,
        awayTeam: item.awayTeam,
        startTime: item.startTime,
        status: MatchStatus.UPCOMING,
        score: undefined,
        summary: undefined,
        markets: generateMarketsForMatch(
          item.homeTeam, 
          item.awayTeam, 
          item.odds?.home || 2.0, 
          item.odds?.away || 2.0, 
          item.odds?.draw || 3.0
        ),
        sourceUrls: sourceUrls.slice(0, 3)
      }));
    }
    
    return [];
  } catch (error) {
    console.error("Error fetching real matches:", error);
    return []; 
  }
};

export const simulateMatchResult = async (match: Match): Promise<SimulatedMatchResult> => {
  try {
    // Basic simulation logic via AI for settling bets
    const prompt = `
      Simulate FINAL result for: ${match.homeTeam} vs ${match.awayTeam}.
      Based on team strength.
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
    // Fallback if simulation fails
    return {
      score: { home: 0, away: 0, htHome: 0, htAway: 0, homeYellowCards: 0, awayYellowCards: 0, homeCorners: 0, awayCorners: 0, scorers: [] },
      summary: "Simulation failed."
    };
  }
};