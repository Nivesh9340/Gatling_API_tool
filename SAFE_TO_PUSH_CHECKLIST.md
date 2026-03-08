# Safe-To-Push Checklist

Use this checklist before pushing `gatling-api-tool` to GitHub.

## 1) Verify ignored/generated files

Confirm these are not committed:
- `target/`
- `node_modules/`
- `dist/*.zip`
- local secret files (`*.p12`, `*.jks`, `*.pem`, `.env*`, etc.)

## 2) Verify no hardcoded secrets

Search for obvious secret keywords in tracked files:
- `API_TOKEN`
- `PASSWORD`
- `KEY`
- `SECRET`
- certificate passwords

Keep env variable names in config, not real values.

## 3) Keep useful docs/artifacts

Recommended to keep in Git:
- `README.md`
- runbook source/docs (`dist/*.pdf`, `dist/*.html`) if you want docs versioned
- scripts under `scripts/`
- `config/app.properties` (without sensitive values)

## 4) First push commands

```bash
git init
git add .
git commit -m "Initial commit: Gatling API tool, runbooks, and automation scripts"
git remote add origin https://github.com/<your-user>/<repo-name>.git
git branch -M main
git push -u origin main
```

## 5) Optional quick checks

```bash
git status
git ls-files
```

If anything sensitive appears, remove it from the commit before push.
