# flashscore-service (vendored)

Copy of https://github.com/omkarcloud/flashscore-scraper (MIT, see LICENSE), taken on 2026-11-11.
One 365SIM patch: `flashscore/matches.py` get_summary also returns `substituted_in` (the player coming on; upstream kept only the player going off). Test: `python -m flashscore.test_substitutions`.
It is a separate Python process. The app starts it BY ITSELF (server/flashscoreProc.js: 127.0.0.1:8765, lazily, restarted with backoff; Dockerfile installs Python + deps in /opt/fsvenv), so there is nothing to configure. FLASHSCORE=0 turns it off; FLASHSCORE_URL points to an external one instead.
The 365SIM server uses 3 endpoints: `/matches`, `/matches/summary`, `/matches/statistics`.

Terms: it reads Flashscore's public feeds. Check Flashscore's terms of use and your local law before enabling it in production;
it can stop working or be blocked at any time. 365SIM keeps working without it (the integration is off unless FLASHSCORE_URL is set).
