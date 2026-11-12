"""365SIM patch test: get_summary attaches the player coming ON to a substitution (the generic parser kept only the player going off).
Run: python -m flashscore.test_substitutions"""
import os
from . import matches as m

def test_substitution_in_player():
    text = open(os.path.join(os.path.dirname(__file__), "fixtures", "match_incidents.txt")).read()
    m._core = lambda mid: {}
    m._feed = lambda name, **k: text
    m.run_parallel = lambda fns: [f() for f in fns]
    r = m.get_summary("GCxZ2uHc")
    subs = [i for p in r["periods"] for i in p["incidents"] if "Substitution" in (i["type"] or "")]
    assert len(subs) == 9
    first = subs[0]
    assert first["player"]["name"] == "Lukebakio D." and first["substituted_in"]["name"] == "Romero I."

if __name__ == "__main__":
    test_substitution_in_player(); print("ok")
