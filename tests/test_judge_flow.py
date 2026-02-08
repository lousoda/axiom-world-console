import sys
from pathlib import Path

# Ensure repo root is on sys.path so `import app` works when pytest changes CWD.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app


def test_judge_flow_demo_path():
    app.reset_in_place()
    app.scenario_basic_auto()

    before_tick = app.world_state.get("tick", 0)
    auto_res = app.auto_tick(limit_agents=50)
    assert auto_res["ok"] is True
    assert app.world_state.get("tick", 0) == before_tick + 1

    world = app.get_world()
    assert isinstance(world.get("agents"), list)
    assert len(world["agents"]) >= 3
    assert world.get("queued_actions", 0) >= 0

    explained = app.explain_recent(limit=50)
    assert explained["ok"] is True
    assert len(explained.get("lines", [])) > 0
