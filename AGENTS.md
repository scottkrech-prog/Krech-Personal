# AGENTS.md — Charlotte Property Detailing App

This repo is the live Charlotte Property Detailing customer closeout / paid invoice app.

## Active repo and live target

- Local repo on Hermes Desktop: `C:\Users\scott\Documents\GitHub\charlotte-property-detailing`
- Branch: `charlotte-property-detailing-app`
- GitHub remote: `git@github.com:scottkrech-prog/Krech-Personal.git`
- Railway project: `charlotte-property-detailing`
- Live URL: `https://charlotte-property-detailing-production.up.railway.app/`

## Important access rules

- Do **not** use `gh`; GitHub CLI may not be installed.
- Use `git` directly.
- The repo has `core.sshCommand` configured with the deploy key. Do not switch the remote back to HTTPS.
- For Railway, use `npx -y @railway/cli@latest`, not the global `railway` command.
- The repo is already linked to the Railway project. Check with:

```powershell
npx -y @railway/cli@latest status
```

## Live site password protection

The live root URL may return `401 Unauthorized` with a password screen. That is expected. Do **not** stop or ask for the repo just because the live root is protected.

For code work, use the local repo first. For verification:

1. Run local checks:

```powershell
npm run check
```

2. If changing invoice/PDF layout, test locally by running the app and submitting a sample service record, or verify after deploy with the authenticated flow.
3. Commit and push.
4. Wait for Railway deploy success.
5. Verify live route/status and exact markers where possible.

## Normal deploy flow

```powershell
cd C:\Users\scott\Documents\GitHub\charlotte-property-detailing
npm run check
git status --short --branch
git add .
git commit -m "Describe change"
git push origin HEAD
npx -y @railway/cli@latest deployment list --json
```

Wait until the newest deployment for the current commit is `SUCCESS` before saying done.

## Product behavior to preserve

- Jerry enters price first and opens a QR code.
- Customer scans QR and fills the form on their own device.
- Price is locked on the customer side.
- Submit creates a paid invoice PDF and redirects to the PDF.
- Email sending is optional/temporary disabled unless SMTP is configured.
- Invoice PDFs should show a red `PAID` stamp and customer signature.

## Communication rule for Scott

Be concise. Do not give long technical explanations unless asked. Report live verification, not just local work.

