# Ayurveda Remedies

A personal Ayurvedic wellbeing guide, built from the classical **Ashtanga Hridaya (Sutrasthana)** by Vagbhata — an ancient public-domain text. Educational only, not medical advice.

Live: https://ayurveda-remedies-two.vercel.app

## What it does
- **Chat** — a personal guide that answers only from the book, grounded in your saved profile, your recent days, and what it has learned about you.
- **Routine** — one small change a week, with a daily "I did this" and a gentle streak. Your guide brings the next change after a week.
- **Remedies** — search or tap any concern for the book's full guidance, each with its chapter. "Ask about this" opens a focused chat on that topic.
- **About me** — your dosha and lifestyle answers (editable) plus a memory of what the guide has learned about you, which you can edit, delete, or add to.

## How it is built
- Static single-page app: `index.html` + `data.js` (30 chapters, ~200 remedies extracted in plain original wording) + `book.js` (chat context).
- Serverless functions (`api/`): `chat`, `plan`, `focus`, `learn` — call an LLM via OpenRouter. Set `OPENROUTER_API_KEY` as an environment variable.
- Installable PWA (`manifest.json`, `sw.js`). Profile, chat, and memory are stored on the device.

## Source and safety
Built from the Ashtanga Hridaya, which is ancient and in the public domain. All content is written in plain, original words, not copied from any modern edition. Clinical therapies (cleansing, bloodletting, surgery, cautery) are described for learning only and must be done by a trained Ayurvedic physician. For real care, see a qualified practitioner.
