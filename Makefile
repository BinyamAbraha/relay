.PHONY: setup start test lint build browser-setup browser-test demo benchmark public-demo public-test
setup:
	bash scripts/setup.sh
start:
	bash scripts/start.sh
test:
	.venv/bin/python -m pytest -q
lint:
	.venv/bin/ruff check relay tests
	.venv/bin/ruff format --check relay tests
	cd web && npx prettier --check src tests demo-tests playwright.config.ts playwright.demo.config.ts vite.config.ts
build:
	npm run --prefix web build
browser-setup:
	cd web && npx playwright install chromium
browser-test:
	npm run --prefix web test:e2e
demo:
	.venv/bin/python -m relay.cli seed
	.venv/bin/python -m relay.cli export web/public/demo.json
	npm run --prefix web build
benchmark:
	.venv/bin/python -m relay.cli benchmark --sizes 100 1000 5000 --repeats 3

public-demo:
	.venv/bin/python scripts/prepare_public_demo.py
	npm run --prefix web build:demo
public-test:
	npm run --prefix web test:demo
