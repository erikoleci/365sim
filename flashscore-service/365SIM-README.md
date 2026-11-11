# flashscore-service (vendored)

Copy of https://github.com/omkarcloud/flashscore-scraper (MIT, see LICENSE), taken on 2026-11-11.
One 365SIM patch: `flashscore/matches.py` get_summary also returns `substituted_in` (the player coming on; upstream kept only the player going off). Test: `python -m flashscore.test_substitutions`.
It is a separate Python process: the 365SIM server only talks to it over HTTP, inside the Docker network, when `FLASHSCORE_URL` is set.
The 365SIM server uses 3 endpoints: `/matches`, `/matches/summary`, `/matches/statistics`.

Terms: it reads Flashscore's public feeds. Check Flashscore's terms of use and your local law before enabling it in production;
it can stop working or be blocked at any time. 365SIM keeps working without it (the integration is off unless FLASHSCORE_URL is set).

Run next to the app (example, add to the production docker-compose; do NOT publish the port):

    flashscore:
      build: ./flashscore-service
      restart: unless-stopped
      expose: ["8000"]
    app:
      environment:
        - FLASHSCORE_URL=http://flashscore:8000
