# IDFL HR Assistant — Trợ lý Nhân sự IDFL

AI chatbot that answers **only** from your HR documents, in **Tiếng Việt (default)** or **English**. If the answer isn't in the documents, it politely declines.

## Setup (one time)

1. Get a free Gemini API key: https://aistudio.google.com/apikey
2. In this folder:
   ```bash
   cp .env.example .env      # then paste your key into GEMINI_API_KEY
   npm install
   npm run ingest            # reads the documents and builds data/index.json
   npm start                 # open http://localhost:3000
   ```

## Adding / updating knowledge

Put `.docx`, `.pdf`, `.txt` or `.md` files into one of the folders listed in `DOCS_DIRS` in `.env`
(by default `../Internal Policies & Handbooks` and `../Taxation & Labor Legislation`, including subfolders), then run:

```bash
npm run ingest
```

Then restart the server. Only new or changed text is re-embedded, so this is quick and cheap.

## Tuning

| Setting | Effect |
|---|---|
| `MIN_SCORE` | Higher = stricter (more refusals); lower = answers more loosely related questions. |
| `TOP_K` | Number of document passages given to the AI per question. |
| `CHAT_MODEL` | Gemini model used to write answers. |

Check quality with `npm test` while the server is running.

## Project structure

```
scripts/ingest.js   extract → chunk → embed documents
scripts/eval.js     answer / refusal test cases
server/index.js     Express server, POST /api/chat (streaming)
server/rag.js       retrieval + answer generation
server/prompts.js   system prompt, refusal messages (VI/EN)
public/             chat UI (HTML/CSS/JS), i18n.js holds all UI text
```
