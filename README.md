# TRMNL Google Fit Connector

A private, self-hosted Google Apps Script connector that lets your [TRMNL](https://usetrmnl.com/) screen show your daily Google Fit metrics.

It displays:

- Steps
- Heart Points
- Move Minutes
- Calories
- Daily goals
- Progress percentages
- Step pace tracking, for example: "by 9 AM target 1,000 steps, by 10 AM target 2,000 steps, by 7 PM target 10,000 steps"

This project is designed for **private personal use**. Each user deploys their own Google Apps Script so their data stays under their own Google account.

---

## Important security note

The Apps Script Web App must be reachable by TRMNL, so the deployment is set to:

- Execute as: `Me`
- Who has access: `Anyone`

To prevent random access, the script requires a private `token` query parameter.

Without the correct token, the endpoint returns:

```json
{"error":"Unauthorized"}
```

Treat the token like a password. Do not publish screenshots or logs containing your full TRMNL polling URL.

---

## Important Google Fit note

Google Fit REST APIs are deprecated and may not be available for every Google account or project. This project is a personal/private workaround and is not recommended as the foundation for a public marketplace product.

---

## Repository structure

```text
trmnl-google-fit-connector/
├── README.md
├── LICENSE
├── .gitignore
├── src/
│   ├── Code.gs
│   ├── appsscript.json
│   └── trmnl-markup.liquid
```

---

## What you need

- A Google account that has Google Fit data
- Google Apps Script access
- Google Cloud Console access
- A TRMNL account/device
- 10–20 minutes

---

# Part 1 — Create the Apps Script project

## 1. Create a new script

Go to:

```text
https://script.new
```

This creates a new Google Apps Script project.

Rename it something like:

```text
TRMNL Google Fit Connector
```

## 2. Add `Code.gs`

Open `src/Code.gs` from this repository.

Copy the entire file.

Paste it into your Apps Script `Code.gs`, replacing anything already there.

Save.

## 3. Show the manifest file

In Apps Script:

1. Click the gear icon on the left: **Project Settings**
2. Turn on: **Show "appsscript.json" manifest file in editor**
3. Go back to the code editor
4. Click `appsscript.json`

## 4. Add `appsscript.json`

Open `src/appsscript.json` from this repository.

Copy the whole file.

Paste it into your Apps Script `appsscript.json`.

Save.

The manifest should include:

```json
{
  "timeZone": "America/New_York",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.storage",
    "https://www.googleapis.com/auth/fitness.activity.read",
    "https://www.googleapis.com/auth/fitness.body.read"
  ],
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

Change `timeZone` if needed.

Examples:

```text
America/New_York
America/Chicago
America/Denver
America/Los_Angeles
Europe/London
Asia/Kolkata
```

---

# Part 2 — Link a Google Cloud project and enable Fitness API

The Google Fit API usually will not work from the default Apps Script project. Use a standard Google Cloud project.

## 1. Create a Google Cloud project

Open:

```text
https://console.cloud.google.com/
```

Then:

1. Click the project dropdown near the top
2. Click **New Project**
3. Name it:

```text
TRMNL Google Fit Connector
```

4. Click **Create**

## 2. Copy the project number

In Google Cloud Console:

1. Open the project dropdown
2. Select your new project
3. Go to **IAM & Admin → Settings**
4. Copy the **Project number**

It will look like a long number.

## 3. Link Apps Script to the Cloud project

Back in Apps Script:

1. Click **Project Settings**
2. Find **Google Cloud Platform (GCP) Project**
3. Click **Change project**
4. Paste the Cloud Project number
5. Click **Set project**

## 4. Configure OAuth consent screen

In Google Cloud Console, with your project selected:

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** for a personal Gmail account
3. Fill:
   - App name: `TRMNL Google Fit Connector`
   - User support email: your email
   - Developer contact email: your email
4. Continue through the wizard
5. Add yourself as a **Test user**
6. Save

If you use a Workspace account, your admin may control these settings.

## 5. Enable Fitness API

In Google Cloud Console:

1. Go to **APIs & Services → Library**
2. Search for:

```text
Fitness API
```

3. Click **Google Fitness API**
4. Click **Enable**

Wait 1–3 minutes.

---

# Part 3 — Generate your private token

Back in Apps Script:

1. Click the function dropdown near the top
2. Select:

```text
setupToken
```

3. Click **Run**
4. Approve permissions
5. Open the **Execution log**
6. Copy the value after:

```text
TRMNL_TOKEN=
```

It will look like a long random string.

Save this token somewhere safe.

If the token ever leaks, run `resetToken` and update your TRMNL polling URL.

---

# Part 4 — Test the Apps Script function

In Apps Script:

1. Select function:

```text
testFetch
```

2. Click **Run**
3. Check the execution log

You should see something like:

```text
{steps=2500, heartPoints=0, moveMinutes=34, calories=900}
```

If you get a Fitness API 403 error, the Fitness API is not enabled on the linked Cloud project.

If you get a permission error for `UrlFetchApp.fetch`, confirm `script.external_request` is in `appsscript.json`, save, run `testFetch` again, and approve permissions.

---

# Part 5 — Deploy as a Web App

In Apps Script:

1. Click **Deploy**
2. Click **New deployment**
3. Select type: **Web app**
4. Set:
   - Description: `Initial deployment`
   - Execute as: `Me`
   - Who has access: `Anyone`
5. Click **Deploy**
6. Copy the Web App URL

It should look like:

```text
https://script.google.com/macros/s/AKfycb.../exec
```

---

# Part 6 — Test the URL

Open your browser and test without a token:

```text
https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
```

Expected result:

```json
{"error":"Unauthorized"}
```

Now test with your token:

```text
https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?token=YOUR_SECRET_TOKEN&steps_goal=6500&heart_goal=20&move_goal=60&cal_goal=2200
```

Expected result:

```json
{
  "dateISO": "2026-01-01",
  "nowHour": 15,
  "totals": {
    "steps": 2500,
    "heartPoints": 0,
    "moveMinutes": 34,
    "calories": 900
  },
  "goals": {
    "steps": 6500,
    "heartPoints": 20,
    "moveMinutes": 60,
    "calories": 2200
  },
  "progress": {
    "steps_pct": 0.3846153846,
    "heart_pct": 0,
    "move_pct": 0.5666666667,
    "cal_pct": 0.4090909091
  }
}
```

---

# Part 7 — Create the TRMNL Private Plugin

In TRMNL:

1. Go to **Plugins**
2. Create a **Private Plugin**
3. Choose **Polling**
4. Set:

```text
Polling Verb: GET
```

5. Polling URL must be one line:

```text
https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?token=YOUR_SECRET_TOKEN&steps_goal=6500&heart_goal=20&move_goal=60&cal_goal=2200
```

6. Leave these empty:
   - Polling Headers
   - Polling Body

7. Click **Parse**

You should see variables like:

```text
dateISO
nowHour
totals
goals
progress
```

## Add the markup

Open `src/trmnl-markup.liquid`.

Copy the full markup into TRMNL's Markup editor.

Save the plugin.

Add it to your playlist.

---

# URL parameters

| Parameter | Description | Default |
|---|---:|---:|
| `token` | Required private token | none |
| `steps_goal` | Daily step goal | `6500` |
| `heart_goal` | Daily heart points goal | `20` |
| `move_goal` | Daily move minutes goal | `60` |
| `cal_goal` | Daily calorie goal | `2200` |
| `window` | Optional rolling window: `24h`, `48h`, `72h` | today midnight -> now |
| `debug` | Optional debug mode: `1` | off |

Example debug URL:

```text
https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?token=YOUR_SECRET_TOKEN&debug=1
```

---

# Troubleshooting

## Error: Unauthorized

You forgot the token or pasted the wrong token.

Fix:

1. Run `setupToken`
2. Copy the token from the execution log
3. Add it to the URL as:

```text
?token=YOUR_SECRET_TOKEN
```

If your URL already has `?`, use `&token=...`.

## Error: You do not have permission to call UrlFetchApp.fetch

Confirm `appsscript.json` includes:

```text
https://www.googleapis.com/auth/script.external_request
```

Then run `testFetch` from Apps Script and approve permissions.

Redeploy a new Web App version.

## Error: invalid_scope

Make sure your manifest does **not** include:

```text
https://www.googleapis.com/auth/script.properties
```

Use this instead:

```text
https://www.googleapis.com/auth/script.storage
```

## Error: Fitness API has not been used or is disabled

Enable the Google Fitness API in the linked Google Cloud project.

## Steps are 0 but Google Fit shows steps

Use debug mode:

```text
/exec?token=YOUR_SECRET_TOKEN&debug=1
```

This script includes fallbacks for Samsung and other device-specific `top_level` streams.

## Heart Points / Move Minutes / Calories are 0

If the Google Fit app itself shows 0, the API will also show 0.

Check:

- Google Fit activity detection is on
- Health Connect permissions allow Google Fit to read/write activity data
- Your wearable or phone is syncing data to Fit
- Your height/weight/profile are set for calorie estimates

## TRMNL shows 0 but browser URL shows real data

In TRMNL:

- Make sure the Polling URL is one line
- Headers are empty
- Body is empty
- Click **Parse**
- Confirm variables appear

---

# License

MIT is included by default. Change it if you prefer another license.
