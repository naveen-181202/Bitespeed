# Bitespeed Backend Task - Identity Reconciliation

This project implements the required `POST /identify` endpoint using:

- Node.js + TypeScript + Express
- Prisma ORM
- PostgreSQL

## API

### Endpoint

`POST /identify`

### Request body

```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```

`email` and `phoneNumber` are optional individually, but at least one must be present.

### Response body

```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": ["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [23]
  }
}
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Push Prisma schema to database:

```bash
npm run prisma:migrate
```

3. Start development server:

```bash
npm run dev
```

Server runs on `http://localhost:3000`.

## Quick test

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"lorraine@hillvalley.edu\",\"phoneNumber\":\"123456\"}"
```

## Deploy

Deploy this service to Render/Railway/Fly and expose:

`https://<your-domain>/identify`

For Render:

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment variable:
  - `DATABASE_URL=<your-neon-or-postgres-url>`

Add your hosted endpoint URL here after deployment:

`HOSTED_ENDPOINT=https://<your-domain>/identify`
