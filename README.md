# Freelance Timer

Freelance Timer is a Chrome extension that tracks how long you spend working on client websites and lets you export polished PDF time reports.

## Features

- Track focused browser time for any URL prefix you configure.
- Quickly add sites from your Chrome history or manually input a pattern (e.g. `https://domain.com/wp-admin`).
- Summaries of total time and per-site breakdowns for any date range.
- Generate branded PDF reports that include favicons, durations, and detailed session information.

## Getting started

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode** (toggle in the upper-right corner).
3. Click **Load unpacked** and select the `extension` folder from this repository.
4. Pin the "Freelance Timer" action to your toolbar for easy access.

## Usage

1. Open the extension popup and add one or more URL prefixes to track.
2. Work as usual—time will be captured whenever an active tab matches your tracked URLs.
3. Return to the popup to review tracked time for a date range or click **Download PDF Report** to create a shareable summary.

> **Tip:** Use the **Suggestions from History** section to quickly fill in client URLs based on your recent browsing.

## PDF exports

The extension renders a visual report, converts it into a PDF, and automatically downloads it. Each report includes:

- The Freelance Timer branding (icon) and selected date range.
- A summary by tracked URL with total hours and session counts.
- Detailed line items showing session times, durations, and URLs with the client's favicon when available.

## Data storage

All tracking data is stored locally in Chrome's extension storage. You can clear the tracked sessions by removing the extension or via Chrome's extension data controls.
