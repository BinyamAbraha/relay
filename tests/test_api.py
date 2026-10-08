from fastapi.testclient import TestClient

from relay.api import create_app


def test_api_full_journey(tmp_path):
    app = create_app(tmp_path, start_worker=False)
    with TestClient(app) as c:
        assert c.get("/api/overview").json()["report"] is None
        request = {"scenario": "baseline", "orders": 4}
        response = c.post(
            "/api/runs", json=request, headers={"Idempotency-Key": "test-request"}
        )
        assert response.status_code == 202
        run_id = response.json()["id"]
        assert (
            c.post(
                "/api/runs", json=request, headers={"Idempotency-Key": "test-request"}
            ).json()["id"]
            == run_id
        )
        app.state.store.execute(run_id)
        assert c.get("/api/overview").json()["report"]["can_publish"]
        page = c.get("/api/orders?limit=2").json()
        assert len(page["items"]) == 2 and page["total"] == 4
        detail = c.get("/api/orders/" + page["items"][0]["order_id"]).json()
        assert detail["events"]
        assert c.get(f"/api/runs/{run_id}/input?line=1").status_code == 200
        assert c.get("/api/runs/missing").status_code == 404
        assert c.get("/api/orders?limit=1000").status_code == 422


def test_mutations_reject_remote_origin(tmp_path):
    with TestClient(create_app(tmp_path, False)) as c:
        assert (
            c.post(
                "/api/runs",
                json={},
                headers={
                    "Origin": "https://evil.example",
                    "Idempotency-Key": "test-evil",
                },
            ).status_code
            == 403
        )
        assert c.post("/api/runs", json={}).status_code == 422
